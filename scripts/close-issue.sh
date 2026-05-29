#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly REQUIRED_COMMENT_FIELDS=(
  "branch name"
  "head commit"
  "files changed"
  "what was done"
  "verification performed"
  "docs reviewed:"
  "docs updated:"
  "changelog updated:"
  "version bump:"
  "tests not run"
  "blockers or follow-up"
)

usage() {
  cat <<'EOF'
Usage:
  scripts/close-issue.sh <issue-number> \
    --version-bump <none|patch|minor> \
    --docs-reviewed <csv-or-none> \
    --docs-updated <csv-or-none> \
    --changelog <yes|no> \
    --close-issue <yes|no> \
    [--dry-run <yes|no>]
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

confirm_or_exit() {
  local prompt="$1"
  read -r -p "$prompt [y/N]: " reply
  reply="${reply,,}"
  [[ "$reply" == "y" || "$reply" == "yes" ]] || die "Cancelled by user."
}

prompt_value() {
  local prompt="$1"
  local -n ref="$2"
  local default="${3:-}"
  if [[ -n "$ref" ]]; then
    return
  fi
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " ref
    ref="${ref:-$default}"
  else
    read -r -p "$prompt: " ref
  fi
}

split_csv() {
  local csv="$1"
  local -n out_ref="$2"
  out_ref=()
  if [[ "$csv" == "none" ]]; then
    return
  fi
  IFS=',' read -r -a out_ref <<<"$csv"
  local i
  for i in "${!out_ref[@]}"; do
    out_ref[$i]="$(echo "${out_ref[$i]}" | xargs)"
    [[ -n "${out_ref[$i]}" ]] || die "Empty entry found in CSV value: $csv"
  done
}

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

check_required_labels() {
  local labels_json="$1"
  local -a label_names=()
  mapfile -t label_names < <(echo "$labels_json" | jq -r '.[].name')

  local agent_count=0
  local area_count=0
  local type_count=0
  local effort_count=0
  local model_count=0
  local reasoning_count=0
  local agent_label=""
  local name

  for name in "${label_names[@]}"; do
    [[ "$name" == agent:* ]] && ((agent_count+=1))
    [[ "$name" == area:* ]] && ((area_count+=1))
    [[ "$name" == type:* ]] && ((type_count+=1))
    [[ "$name" == effort:* ]] && ((effort_count+=1))
    [[ "$name" == model:* ]] && ((model_count+=1))
    [[ "$name" == reasoning:* ]] && ((reasoning_count+=1))
    if [[ "$name" == agent:* ]]; then
      agent_label="$name"
    fi
  done

  [[ "$agent_count" -eq 1 ]] || die "Issue must have exactly one agent: label."
  [[ "$area_count" -ge 1 ]] || die "Issue must have at least one area: label."
  [[ "$type_count" -eq 1 ]] || die "Issue must have exactly one type: label."
  [[ "$effort_count" -le 1 ]] || die "Issue must have at most one effort: label."

  case "$agent_label" in
    agent:codex)
      [[ "$model_count" -eq 1 ]] || die "agent:codex requires exactly one model: label."
      [[ "$reasoning_count" -eq 1 ]] || die "agent:codex requires exactly one reasoning: label."
      ;;
    agent:claude)
      [[ "$reasoning_count" -eq 1 ]] || die "agent:claude requires exactly one reasoning: label."
      ;;
    agent:gemini)
      ;;
    *)
      die "Unknown agent label: $agent_label"
      ;;
  esac
}

has_completion_comment() {
  local comments_json="$1"
  local content
  mapfile -t content < <(echo "$comments_json" | jq -r '.[].body // ""')
  local body
  local field
  for body in "${content[@]}"; do
    local lowered="${body,,}"
    local all_present="yes"
    for field in "${REQUIRED_COMMENT_FIELDS[@]}"; do
      if [[ "$lowered" != *"$field"* ]]; then
        all_present="no"
        break
      fi
    done
    [[ "$all_present" == "yes" ]] && return 0
  done
  return 1
}

infer_triggered_docs() {
  local -n changed_ref="$1"
  local -n out_ref="$2"
  out_ref=()

  local f
  local trigger_current_state="no"
  local trigger_repo_structure="no"
  local trigger_testing="no"
  local trigger_architecture="no"
  local trigger_roadmap="no"

  for f in "${changed_ref[@]}"; do
    if [[ "$f" == */* ]]; then
      local top="${f%%/*}"
      if [[ "$top" != "docs" && "$top" != "tests" ]]; then
        trigger_current_state="yes"
      fi
    fi

    if [[ "$f" == tests/* || "$f" == *test* || "$f" == "vitest.config.js" ]]; then
      trigger_testing="yes"
    fi

    if [[ "$f" == package.json || "$f" == package-lock.json || "$f" == mobile/package.json || "$f" == mobile/package-lock.json || "$f" == mobile/storage/* || "$f" == mobile/hooks/* || "$f" == src/storage/* || "$f" == src/hooks/* ]]; then
      trigger_architecture="yes"
    fi

    if [[ "$f" != */* ]]; then
      trigger_repo_structure="yes"
    fi
  done

  [[ "$trigger_current_state" == "yes" ]] && out_ref+=("docs/current-state.md")
  [[ "$trigger_repo_structure" == "yes" ]] && out_ref+=("docs/repo-structure.md")
  [[ "$trigger_testing" == "yes" ]] && out_ref+=("docs/testing-and-qa.md")
  [[ "$trigger_architecture" == "yes" ]] && out_ref+=("docs/architecture.md")
  [[ "$trigger_roadmap" == "yes" ]] && out_ref+=("docs/mvp-roadmap.md")
}

bump_version() {
  local current="$1"
  local bump="$2"
  if [[ "$bump" == "none" ]]; then
    echo "$current"
    return
  fi
  local major minor patch
  IFS='.' read -r major minor patch <<<"$current"
  [[ -n "$major" && -n "$minor" && -n "$patch" ]] || die "Invalid version format: $current"
  case "$bump" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    *) die "Unsupported version bump: $bump" ;;
  esac
  echo "${major}.${minor}.${patch}"
}

ensure_changelog_entry() {
  local changelog_path="$1"
  local target_version="$2"
  local issue_number="$3"
  local issue_title="$4"
  local today="$5"
  local heading="## ${target_version} - ${today}"
  local bullet="- Issue #${issue_number}: ${issue_title}"
  local tmp
  tmp="$(mktemp)"

  if grep -Fq "$heading" "$changelog_path"; then
    awk -v heading="$heading" -v bullet="$bullet" '
      BEGIN {in_section=0; found=0}
      {
        if ($0 == heading) {
          in_section=1
          print
          next
        }
        if (in_section == 1 && $0 ~ /^## /) {
          if (found == 0) {
            print ""
            print bullet
            found=1
          }
          in_section=0
        }
        if (in_section == 1 && $0 == bullet) {
          found=1
        }
        print
      }
      END {
        if (in_section == 1 && found == 0) {
          print ""
          print bullet
        }
      }
    ' "$changelog_path" >"$tmp"
  else
    awk -v heading="$heading" -v bullet="$bullet" '
      NR==1 {
        print $0
        print ""
        print heading
        print ""
        print bullet
        print ""
        next
      }
      {print}
    ' "$changelog_path" >"$tmp"
  fi
  mv "$tmp" "$changelog_path"
}

main() {
  need_cmd gh
  need_cmd git
  need_cmd jq
  need_cmd npm
  need_cmd node

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  [[ $# -ge 1 ]] || {
    usage
    die "Missing issue number."
  }

  local issue_number="$1"
  shift
  [[ "$issue_number" =~ ^[0-9]+$ ]] || die "Issue number must be numeric."

  local version_bump=""
  local docs_reviewed_raw=""
  local docs_updated_raw=""
  local changelog_flag=""
  local close_issue_flag=""
  local dry_run="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version-bump) version_bump="${2:-}"; shift 2 ;;
      --docs-reviewed) docs_reviewed_raw="${2:-}"; shift 2 ;;
      --docs-updated) docs_updated_raw="${2:-}"; shift 2 ;;
      --changelog) changelog_flag="${2:-}"; shift 2 ;;
      --close-issue) close_issue_flag="${2:-}"; shift 2 ;;
      --dry-run) dry_run="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown argument: $1" ;;
    esac
  done

  prompt_value "Version bump (none|patch|minor)" version_bump "none"
  prompt_value "Docs reviewed CSV or 'none'" docs_reviewed_raw "none"
  prompt_value "Docs updated CSV or 'none'" docs_updated_raw "none"
  prompt_value "Update changelog? (yes|no)" changelog_flag "no"
  prompt_value "Close GitHub issue? (yes|no)" close_issue_flag "no"
  prompt_value "Dry run? (yes|no)" dry_run "yes"

  [[ "$version_bump" == "none" || "$version_bump" == "patch" || "$version_bump" == "minor" ]] || die "--version-bump must be one of: none|patch|minor"
  [[ "$changelog_flag" == "yes" || "$changelog_flag" == "no" ]] || die "--changelog must be yes|no"
  [[ "$close_issue_flag" == "yes" || "$close_issue_flag" == "no" ]] || die "--close-issue must be yes|no"
  [[ "$dry_run" == "yes" || "$dry_run" == "no" ]] || die "--dry-run must be yes|no"
  [[ -n "$docs_reviewed_raw" ]] || die "--docs-reviewed is required (or 'none')"
  [[ -n "$docs_updated_raw" ]] || die "--docs-updated is required (or 'none')"

  local -a docs_reviewed=()
  local -a docs_updated=()
  split_csv "$docs_reviewed_raw" docs_reviewed
  split_csv "$docs_updated_raw" docs_updated

  local current_branch
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$current_branch" != "main" ]] || die "Current branch must not be main."
  [[ "$current_branch" =~ ^issue/${issue_number}-[a-z0-9-]+$ ]] || die "Current branch must match issue/${issue_number}-<short-kebab-scope>."

  [[ -z "$(git status --porcelain)" ]] || die "Worktree must be clean before closeout."

  local issue_json
  issue_json="$(gh issue view "$issue_number" --json number,title,labels,body,state,repository)"
  local issue_title issue_repo issue_state
  issue_title="$(echo "$issue_json" | jq -r '.title')"
  issue_repo="$(echo "$issue_json" | jq -r '.repository.nameWithOwner')"
  issue_state="$(echo "$issue_json" | jq -r '.state')"
  [[ "$issue_state" == "OPEN" ]] || die "Issue #$issue_number is not open."

  check_required_labels "$(echo "$issue_json" | jq '.labels')"

  local comments_json
  comments_json="$(gh api "repos/${issue_repo}/issues/${issue_number}/comments")"
  has_completion_comment "$comments_json" || die "Missing completion comment with all required AGENTS.md fields."

  mapfile -t changed_files < <(git diff --name-only "main...${current_branch}")
  [[ "${#changed_files[@]}" -gt 0 ]] || die "No changes found between main and ${current_branch}."

  local -a triggered_docs=()
  infer_triggered_docs changed_files triggered_docs

  echo "Triggered living docs inferred from changed files:"
  if [[ "${#triggered_docs[@]}" -eq 0 ]]; then
    echo "- none"
  else
    printf -- '- %s\n' "${triggered_docs[@]}"
  fi

  local path
  for path in "${docs_reviewed[@]}"; do
    [[ -f "$path" ]] || die "Reviewed doc path does not exist: $path"
  done
  for path in "${docs_updated[@]}"; do
    [[ -f "$path" ]] || die "Updated doc path does not exist: $path"
    git diff --quiet -- "$path" && die "Declared updated doc has no git diff: $path"
  done

  local tdoc
  for tdoc in "${triggered_docs[@]}"; do
    if ! array_contains "$tdoc" "${docs_reviewed[@]}" && ! array_contains "$tdoc" "${docs_updated[@]}"; then
      die "Triggered doc not accounted for in --docs-reviewed or --docs-updated: $tdoc"
    fi
  done

  local current_version target_version today
  current_version="$(node -p "require('./package.json').version")"
  target_version="$(bump_version "$current_version" "$version_bump")"
  today="$(date +%F)"

  if [[ "$dry_run" == "yes" ]]; then
    echo "DRY RUN: validations passed."
    echo "DRY RUN: would edit CHANGELOG.md: ${changelog_flag}"
    echo "DRY RUN: would bump version: ${version_bump} (${current_version} -> ${target_version})"
    echo "DRY RUN: would commit on ${current_branch}"
    echo "DRY RUN: would merge ${current_branch} into main"
    echo "DRY RUN: would push main to origin"
    echo "DRY RUN: would close issue #${issue_number}: ${close_issue_flag}"
    echo "DRY RUN: would fast-forward local main to origin/main"
    echo "DRY RUN: would delete branch ${current_branch}"
    exit 0
  fi

  if [[ "$changelog_flag" == "yes" || "$version_bump" != "none" ]]; then
    confirm_or_exit "Proceed with changelog/version edits?"
  fi

  if [[ "$changelog_flag" == "yes" ]]; then
    ensure_changelog_entry "CHANGELOG.md" "$target_version" "$issue_number" "$issue_title" "$today"
  fi

  if [[ "$version_bump" != "none" ]]; then
    npm version "$version_bump" --no-git-tag-version >/dev/null
  fi

  # Propagate the canonical root version into the mobile files (displayed
  # version + OTA runtime boundary). Idempotent: a no-op when already aligned.
  node scripts/sync-version.mjs

  git add -A
  echo "Staged files:"
  git diff --cached --name-only

  confirm_or_exit "Create closeout commit now?"
  git commit -m "chore: close issue #${issue_number}"

  confirm_or_exit "Merge ${current_branch} into main?"
  git checkout main
  git merge --no-ff "$current_branch"

  confirm_or_exit "Push main to origin?"
  git push origin main

  if [[ "$close_issue_flag" == "yes" ]]; then
    confirm_or_exit "Close GitHub issue #${issue_number}?"
    gh issue close "$issue_number"
  fi

  git fetch origin
  git merge --ff-only origin/main

  confirm_or_exit "Delete issue branch ${current_branch}?"
  git branch -d "$current_branch"

  [[ -z "$(git status --porcelain)" ]] || die "Repository is not clean after closeout."
  echo "Closeout complete. Repository is clean on main."
}

main "$@"
