// Compatibility barrel: shared UI primitives, split by family under ./ui/*.
// Every export below is re-exported unchanged so existing imports from
// 'components/UI' keep working without migration.

export {
  SET_ROW_FONT_SIZE,
  HeroMetric,
  createInputStyle,
  useInputStyle,
} from './ui/styles';

export { LineChart } from './LineChart';

export {
  Card,
  SectionTitle,
  ArtisanalPanel,
} from './ui/containers';

export {
  Button,
  Chip,
  Badge,
} from './ui/controls';

export {
  getSessionTone,
  getSessionZoneCaption,
  SessionGauge,
  StatCard,
  WorkoutHeading,
  WorkoutSubheading,
  ExerciseBlock,
  SetLine,
  AnnotationNote,
} from './ui/workout';

export {
  UnparsedRow,
  NoteParseError,
  ErrorBanner,
} from './ui/feedback';
