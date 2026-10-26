import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
const mainActivityPath = path.join(
  process.cwd(),
  'android/app/src/main/java/com/storytold/wordcraft/MainActivity.java'
);

if (fs.existsSync(manifestPath)) {
  let xml = fs.readFileSync(manifestPath, 'utf8');

  // 1. Add storage permissions for saving/opening documents on all Android versions
  const permissionsBlock = `
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
`;
  if (!xml.includes('WRITE_EXTERNAL_STORAGE')) {
    xml = xml.replace('</manifest>', `${permissionsBlock}\n</manifest>`);
  }

  // 2. Enable largeHeap, hardwareAccelerated & requestLegacyExternalStorage on <application>
  if (!xml.includes('android:largeHeap="true"')) {
    xml = xml.replace(
      '<application',
      '<application\n        android:largeHeap="true"\n        android:hardwareAccelerated="true"\n        android:requestLegacyExternalStorage="true"'
    );
  }

  // 3. Ensure activity handles orientation changes smoothly and resizes for virtual keyboard
  if (!xml.includes('android:windowSoftInputMode')) {
    xml = xml.replace(
      'android:launchMode="singleTask"',
      'android:launchMode="singleTask"\n            android:windowSoftInputMode="adjustResize"'
    );
  }

  fs.writeFileSync(manifestPath, xml, 'utf8');
  console.log('✅ Configured AndroidManifest.xml (storage permissions, largeHeap, hardwareAccelerated)');
} else {
  console.warn('⚠️ AndroidManifest.xml not found, skipping manifest patch.');
}

// Configure MainActivity.java with:
// 1. Immersive Sticky Fullscreen (hides Android Status Bar & Navigation Bar)
// 2. Native Java @JavascriptInterface ("WordCraftAndroid") for:
//    - Saving files directly to /sdcard/Download/ (MediaStore on Android 10+, Environment on older)
//    - Native Android "Save As..." system dialog (Intent.ACTION_CREATE_DOCUMENT)
//    - Native Android Share / Open file intent (FileProvider)
//    - Native Android Clipboard (Copy & Paste)
if (fs.existsSync(path.dirname(mainActivityPath))) {
  const javaCode = `package com.storytold.wordcraft;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {
    private static final int REQ_CREATE_DOCUMENT = 9401;
    private byte[] pendingSaveBytes = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();

        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);
                webView.addJavascriptInterface(new WordCraftNativeBridge(), "WordCraftAndroid");
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CREATE_DOCUMENT) {
            final byte[] bytesToWrite = pendingSaveBytes;
            pendingSaveBytes = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null && bytesToWrite != null) {
                Uri uri = data.getData();
                try {
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os != null) {
                        os.write(bytesToWrite);
                        os.flush();
                        os.close();
                        Toast.makeText(this, "✅ Dokumen berhasil disimpan!", Toast.LENGTH_LONG).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(this, "❌ Gagal menyimpan: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        }
    }

    private void hideSystemBars() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                }
            } else {
                View decorView = getWindow().getDecorView();
                decorView.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                );
            }
        } catch (Exception ignored) {}
    }

    public class WordCraftNativeBridge {
        @JavascriptInterface
        public String saveToDownloads(String base64Data, String fileName, String mimeType) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType != null ? mimeType : "application/octet-stream");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/WordCraft");
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        OutputStream os = resolver.openOutputStream(uri);
                        if (os != null) {
                            os.write(bytes);
                            os.flush();
                            os.close();
                        }
                        runOnUiThread(() -> Toast.makeText(
                            MainActivity.this,
                            "✅ Tersimpan di Download/WordCraft/" + fileName,
                            Toast.LENGTH_LONG
                        ).show());
                        return "Download/WordCraft/" + fileName;
                    }
                }
                // Fallback for older Android or direct file access
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "WordCraft");
                if (!dir.exists()) {
                    dir.mkdirs();
                }
                File outFile = new File(dir, fileName);
                FileOutputStream fos = new FileOutputStream(outFile);
                fos.write(bytes);
                fos.flush();
                fos.close();
                MediaScannerConnection.scanFile(MainActivity.this, new String[]{outFile.getAbsolutePath()}, null, null);
                runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    "✅ Tersimpan di Download/WordCraft/" + fileName,
                    Toast.LENGTH_LONG
                ).show());
                return outFile.getAbsolutePath();
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    "❌ Gagal simpan otomatis: " + e.getMessage(),
                    Toast.LENGTH_LONG
                ).show());
                return "";
            }
        }

        @JavascriptInterface
        public void saveWithSystemPicker(String base64Data, String fileName, String mimeType) {
            try {
                pendingSaveBytes = Base64.decode(base64Data, Base64.DEFAULT);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType != null && !mimeType.isEmpty() ? mimeType : "*/*");
                intent.putExtra(Intent.EXTRA_TITLE, fileName);
                startActivityForResult(intent, REQ_CREATE_DOCUMENT);
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    "❌ Gagal membuka dialog Save As: " + e.getMessage(),
                    Toast.LENGTH_LONG
                ).show());
            }
        }

        @JavascriptInterface
        public void shareFile(String base64Data, String fileName, String mimeType) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                File cacheDir = new File(getCacheDir(), "shared_docs");
                if (!cacheDir.exists()) {
                    cacheDir.mkdirs();
                }
                File file = new File(cacheDir, fileName);
                FileOutputStream fos = new FileOutputStream(file);
                fos.write(bytes);
                fos.flush();
                fos.close();

                Uri uri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    file
                );
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType != null ? mimeType : "application/octet-stream");
                shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(shareIntent, "Bagikan / Simpan " + fileName));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    "❌ Gagal membagikan file: " + e.getMessage(),
                    Toast.LENGTH_LONG
                ).show());
            }
        }

        @JavascriptInterface
        public void copyText(String text) {
            try {
                ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cb != null) {
                    cb.setPrimaryClip(ClipData.newPlainText("WordCraft", text));
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String pasteText() {
            try {
                ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cb != null && cb.hasPrimaryClip() && cb.getPrimaryClip() != null && cb.getPrimaryClip().getItemCount() > 0) {
                    CharSequence cs = cb.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                    return cs != null ? cs.toString() : "";
                }
            } catch (Exception ignored) {}
            return "";
        }
    }
}
`;
  fs.writeFileSync(mainActivityPath, javaCode, 'utf8');
  console.log('✅ Configured MainActivity.java with WordCraftNativeBridge (Save, Save As, Share, Clipboard)');
}
