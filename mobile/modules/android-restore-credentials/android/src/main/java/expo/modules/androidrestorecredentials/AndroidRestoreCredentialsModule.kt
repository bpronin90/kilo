package expo.modules.androidrestorecredentials

import android.app.Activity
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CreateRestoreCredentialRequest
import androidx.credentials.CreateRestoreCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetRestoreCredentialOption
import androidx.credentials.RestoreCredential
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.ClearCredentialProviderConfigurationException
import androidx.credentials.exceptions.ClearCredentialUnsupportedException
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialProviderConfigurationException
import androidx.credentials.exceptions.CreateCredentialUnsupportedException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val STATUS_SUCCESS = "success"
private const val STATUS_UNSUPPORTED = "unsupported"
private const val STATUS_UNAVAILABLE = "unavailable"
private const val STATUS_CANCELLED = "cancelled"
private const val STATUS_MALFORMED = "malformed"
private const val STATUS_ERROR = "error"

/**
 * Local Expo module bridging AndroidX Credential Manager's Restore
 * Credentials APIs (issue #1158). It only classifies and forwards
 * credential-manager results/errors; it never persists Supabase tokens or
 * other credential-private material itself, and it never implements a
 * JavaScript-only fallback for a platform/provider that doesn't support
 * Restore Credentials.
 */
class AndroidRestoreCredentialsModule : Module() {
  private val currentActivity: Activity
    get() = appContext.currentActivity ?: throw Exceptions.MissingActivity()

  override fun definition() = ModuleDefinition {
    Name("AndroidRestoreCredentials")

    AsyncFunction("createRestoreCredential") Coroutine { requestJson: String ->
      return@Coroutine try {
        val credentialManager = CredentialManager.create(currentActivity)
        val request = CreateRestoreCredentialRequest(requestJson)
        val response = credentialManager.createCredential(currentActivity, request)
        val responseJson = (response as? CreateRestoreCredentialResponse)?.responseJson
        if (responseJson.isNullOrEmpty()) {
          mapOf("status" to STATUS_MALFORMED)
        } else {
          mapOf("status" to STATUS_SUCCESS, "responseJson" to responseJson)
        }
      } catch (error: CreateCredentialCancellationException) {
        mapOf("status" to STATUS_CANCELLED)
      } catch (error: CreateCredentialProviderConfigurationException) {
        mapOf("status" to STATUS_UNAVAILABLE, "message" to error.message)
      } catch (error: CreateCredentialUnsupportedException) {
        mapOf("status" to STATUS_UNSUPPORTED, "message" to error.message)
      } catch (error: CreateCredentialException) {
        mapOf("status" to STATUS_ERROR, "message" to error.message)
      } catch (error: Exception) {
        mapOf("status" to STATUS_ERROR, "message" to error.message)
      }
    }

    AsyncFunction("getRestoreCredential") Coroutine { requestJson: String ->
      return@Coroutine try {
        val credentialManager = CredentialManager.create(currentActivity)
        val request = GetCredentialRequest(listOf(GetRestoreCredentialOption(requestJson)))
        val response = credentialManager.getCredential(currentActivity, request)
        val credential = response.credential
        val credentialJson = (credential as? RestoreCredential)?.authenticationResponseJson
        if (credentialJson.isNullOrEmpty()) {
          mapOf("status" to STATUS_MALFORMED)
        } else {
          mapOf(
            "status" to STATUS_SUCCESS,
            "credentialJson" to credentialJson,
            "type" to credential.type
          )
        }
      } catch (error: GetCredentialCancellationException) {
        mapOf("status" to STATUS_CANCELLED)
      } catch (error: NoCredentialException) {
        mapOf("status" to STATUS_UNAVAILABLE, "message" to error.message)
      } catch (error: GetCredentialProviderConfigurationException) {
        mapOf("status" to STATUS_UNAVAILABLE, "message" to error.message)
      } catch (error: GetCredentialUnsupportedException) {
        mapOf("status" to STATUS_UNSUPPORTED, "message" to error.message)
      } catch (error: GetCredentialException) {
        mapOf("status" to STATUS_ERROR, "message" to error.message)
      } catch (error: Exception) {
        mapOf("status" to STATUS_ERROR, "message" to error.message)
      }
    }

    AsyncFunction("clearRestoreCredential") Coroutine { ->
      return@Coroutine try {
        val credentialManager = CredentialManager.create(currentActivity)
        credentialManager.clearCredentialState(
          ClearCredentialStateRequest(ClearCredentialStateRequest.TYPE_CLEAR_RESTORE_CREDENTIAL)
        )
        mapOf("status" to STATUS_SUCCESS)
      } catch (error: ClearCredentialProviderConfigurationException) {
        mapOf("status" to STATUS_UNAVAILABLE, "message" to error.message)
      } catch (error: ClearCredentialUnsupportedException) {
        mapOf("status" to STATUS_UNSUPPORTED, "message" to error.message)
      } catch (error: ClearCredentialException) {
        mapOf("status" to STATUS_ERROR, "message" to error.message)
      } catch (error: Exception) {
        mapOf("status" to STATUS_ERROR, "message" to error.message)
      }
    }
  }
}
