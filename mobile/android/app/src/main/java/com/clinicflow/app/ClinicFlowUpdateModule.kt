package com.clinicflow.app

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

class ClinicFlowUpdateModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "ClinicFlowUpdateInstaller"

  @ReactMethod
  fun canRequestPackageInstalls(promise: Promise) {
    val allowed =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.packageManager.canRequestPackageInstalls()
      } else {
        true
      }
    promise.resolve(allowed)
  }

  @ReactMethod
  fun openUnknownSourcesSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(true)
      return
    }

    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${reactApplicationContext.packageName}"),
      ).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (_: Exception) {
      promise.reject(
        "UPDATE_SETTINGS_UNAVAILABLE",
        "Unable to open Android install-permission settings.",
      )
    }
  }

  @ReactMethod
  fun downloadAndInstall(
    apkUrl: String,
    expectedSha256: String,
    expectedVersionCode: Double,
    promise: Promise,
  ) {
    if (!isPackageInstallAllowed()) {
      promise.reject(
        "UPDATE_INSTALL_PERMISSION_REQUIRED",
        "Allow ClinicFlow to install updates before continuing.",
      )
      return
    }

    val validatedUrl = try {
      validateReleaseUrl(apkUrl)
    } catch (error: UpdateException) {
      promise.reject(error.code, error.message)
      return
    }

    val expectedHash = expectedSha256.trim().lowercase()
    if (!SHA256_PATTERN.matches(expectedHash)) {
      promise.reject("UPDATE_METADATA_INVALID", "The update checksum is invalid.")
      return
    }

    val expectedCode = expectedVersionCode.toLong()
    if (
      !expectedVersionCode.isFinite()
      || expectedVersionCode < 1.0
      || expectedVersionCode % 1.0 != 0.0
      || expectedCode > Int.MAX_VALUE
    ) {
      promise.reject("UPDATE_METADATA_INVALID", "The update version code is invalid.")
      return
    }

    executor.execute {
      var apk: File? = null
      try {
        apk = downloadVerifiedApk(validatedUrl, expectedHash)
        verifyApkIdentity(apk, expectedCode)
        launchInstaller(apk)
        promise.resolve(true)
      } catch (error: UpdateException) {
        apk?.delete()
        promise.reject(error.code, error.message)
      } catch (_: Exception) {
        apk?.delete()
        promise.reject(
          "UPDATE_DOWNLOAD_FAILED",
          "Unable to download and verify the ClinicFlow update.",
        )
      }
    }
  }

  private fun isPackageInstallAllowed(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactApplicationContext.packageManager.canRequestPackageInstalls()
    } else {
      true
    }

  private fun validateReleaseUrl(value: String): URL {
    val url = try {
      URL(value.trim())
    } catch (_: Exception) {
      throw UpdateException("UPDATE_METADATA_INVALID", "The update download address is invalid.")
    }

    val validPath =
      url.path.startsWith(CLINICFLOW_RELEASE_PATH_PREFIX) &&
        url.path.lowercase().endsWith(".apk")
    if (
      url.protocol != "https"
      || url.host != "github.com"
      || url.userInfo != null
      || url.query != null
      || url.ref != null
      || !validPath
    ) {
      throw UpdateException(
        "UPDATE_METADATA_INVALID",
        "The update download address is not an approved ClinicFlow GitHub Release APK.",
      )
    }
    return url
  }

  private fun downloadVerifiedApk(url: URL, expectedHash: String): File {
    val updateDir = File(reactApplicationContext.cacheDir, "updates").apply {
      if (!exists() && !mkdirs()) {
        throw UpdateException("UPDATE_STORAGE_FAILED", "Unable to prepare update storage.")
      }
    }
    val partial = File(updateDir, "clinicflow-update.apk.part")
    val verified = File(updateDir, "clinicflow-update.apk")
    partial.delete()
    verified.delete()

    val connection = (url.openConnection() as HttpURLConnection).apply {
      connectTimeout = CONNECT_TIMEOUT_MS
      readTimeout = READ_TIMEOUT_MS
      instanceFollowRedirects = true
      requestMethod = "GET"
      setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream")
      setRequestProperty("User-Agent", "ClinicFlow-Android-Updater")
    }

    try {
      val status = connection.responseCode
      if (status !in 200..299 || connection.url.protocol != "https") {
        throw UpdateException("UPDATE_DOWNLOAD_FAILED", "The update server did not return a valid APK.")
      }

      val declaredLength = connection.contentLengthLong
      if (declaredLength > MAX_APK_BYTES) {
        throw UpdateException("UPDATE_TOO_LARGE", "The update package is larger than ClinicFlow allows.")
      }

      val digest = MessageDigest.getInstance("SHA-256")
      var total = 0L
      connection.inputStream.use { input ->
        FileOutputStream(partial).use { output ->
          val buffer = ByteArray(BUFFER_SIZE)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > MAX_APK_BYTES) {
              throw UpdateException("UPDATE_TOO_LARGE", "The update package is larger than ClinicFlow allows.")
            }
            digest.update(buffer, 0, read)
            output.write(buffer, 0, read)
          }
          output.fd.sync()
        }
      }

      if (total <= 0L) {
        throw UpdateException("UPDATE_DOWNLOAD_FAILED", "The downloaded update package is empty.")
      }

      val actualHash = digest.digest().joinToString("") { byte -> "%02x".format(byte) }
      if (actualHash != expectedHash) {
        throw UpdateException(
          "UPDATE_CHECKSUM_MISMATCH",
          "The downloaded update failed integrity verification.",
        )
      }

      if (!partial.renameTo(verified)) {
        partial.copyTo(verified, overwrite = true)
        partial.delete()
      }
      return verified
    } catch (error: UpdateException) {
      partial.delete()
      verified.delete()
      throw error
    } catch (_: Exception) {
      partial.delete()
      verified.delete()
      throw UpdateException(
        "UPDATE_DOWNLOAD_FAILED",
        "Unable to download and verify the ClinicFlow update.",
      )
    } finally {
      connection.disconnect()
    }
  }

  private fun verifyApkIdentity(apk: File, expectedVersionCode: Long) {
    val packageManager = reactApplicationContext.packageManager
    val archive = packageInfoForArchive(packageManager, apk)
      ?: throw UpdateException(
        "UPDATE_APK_INVALID",
        "The downloaded file is not a valid Android package.",
      )
    val installed = installedPackageInfo(packageManager)

    if (archive.packageName != reactApplicationContext.packageName) {
      throw UpdateException(
        "UPDATE_PACKAGE_MISMATCH",
        "The downloaded package is not a ClinicFlow update.",
      )
    }

    val archiveCode = versionCodeOf(archive)
    val installedCode = versionCodeOf(installed)
    if (archiveCode != expectedVersionCode || archiveCode <= installedCode) {
      throw UpdateException(
        "UPDATE_VERSION_MISMATCH",
        "The downloaded package version does not match the ClinicFlow update policy.",
      )
    }

    val archiveSigners = signerDigests(archive)
    val installedSigners = signerDigests(installed)
    if (archiveSigners.isEmpty() || archiveSigners != installedSigners) {
      throw UpdateException(
        "UPDATE_SIGNATURE_MISMATCH",
        "The downloaded package is not signed by the installed ClinicFlow signing key.",
      )
    }
  }

  @Suppress("DEPRECATION")
  private fun packageInfoForArchive(packageManager: PackageManager, apk: File): PackageInfo? {
    val flags =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        PackageManager.GET_SIGNING_CERTIFICATES
      } else {
        PackageManager.GET_SIGNATURES
      }
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageArchiveInfo(
        apk.absolutePath,
        PackageManager.PackageInfoFlags.of(flags.toLong()),
      )
    } else {
      packageManager.getPackageArchiveInfo(apk.absolutePath, flags)
    }
  }

  @Suppress("DEPRECATION")
  private fun installedPackageInfo(packageManager: PackageManager): PackageInfo {
    val flags =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        PackageManager.GET_SIGNING_CERTIFICATES
      } else {
        PackageManager.GET_SIGNATURES
      }
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageInfo(
        reactApplicationContext.packageName,
        PackageManager.PackageInfoFlags.of(flags.toLong()),
      )
    } else {
      packageManager.getPackageInfo(reactApplicationContext.packageName, flags)
    }
  }

  @Suppress("DEPRECATION")
  private fun versionCodeOf(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
    else info.versionCode.toLong()

  @Suppress("DEPRECATION")
  private fun signaturesOf(info: PackageInfo): Array<Signature> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = info.signingInfo ?: return emptyArray()
      if (signingInfo.hasMultipleSigners()) {
        signingInfo.apkContentsSigners
      } else {
        signingInfo.signingCertificateHistory
      }
    } else {
      info.signatures ?: emptyArray()
    }

  private fun signerDigests(info: PackageInfo): Set<String> =
    signaturesOf(info).mapTo(mutableSetOf()) { signature ->
      MessageDigest.getInstance("SHA-256")
        .digest(signature.toByteArray())
        .joinToString("") { byte -> "%02x".format(byte) }
    }

  private fun launchInstaller(apk: File) {
    val contentUri = FileProvider.getUriForFile(
      reactApplicationContext,
      "${reactApplicationContext.packageName}.fileprovider",
      apk,
    )
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(contentUri, APK_MIME_TYPE)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    if (intent.resolveActivity(reactApplicationContext.packageManager) == null) {
      throw UpdateException("UPDATE_INSTALLER_UNAVAILABLE", "Android package installer is unavailable.")
    }
    reactApplicationContext.startActivity(intent)
  }

  private class UpdateException(
    val code: String,
    override val message: String,
  ) : Exception(message)

  companion object {
    private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    private const val CLINICFLOW_RELEASE_PATH_PREFIX = "/Er-Arif/clinicflow/releases/download/"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val BUFFER_SIZE = 64 * 1024
    private const val MAX_APK_BYTES = 250L * 1024L * 1024L
    private val SHA256_PATTERN = Regex("^[0-9a-fA-F]{64}$")
  }
}