import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
const mainActivityPath = path.join(
  process.cwd(),
  'android/app/src/main/java/com/storytold/wordcraft/MainActivity.java'
);

if (fs.existsSync(manifestPath)) {
  let xml = fs.readFileSync(manifestPath, 'utf8');

  // Enable largeHeap & hardwareAccelerated on <application> for smooth 46MB WASM + WebGPU/WebGL2 rendering
  if (!xml.includes('android:largeHeap="true"')) {
    xml = xml.replace(
      '<application',
      '<application\n        android:largeHeap="true"\n        android:hardwareAccelerated="true"'
    );
  }

  // Ensure activity handles orientation changes smoothly and resizes for virtual keyboard
  if (!xml.includes('android:windowSoftInputMode')) {
    xml = xml.replace(
      'android:launchMode="singleTask"',
      'android:launchMode="singleTask"\n            android:windowSoftInputMode="adjustResize"'
    );
  }

  fs.writeFileSync(manifestPath, xml, 'utf8');
  console.log('✅ Configured AndroidManifest.xml (largeHeap, hardwareAccelerated, adjustResize)');
} else {
  console.warn('⚠️ AndroidManifest.xml not found, skipping manifest patch.');
}

// Configure MainActivity.java to hide Android Status Bar & Navigation Bar (Immersive Sticky Mode)
// so the top menu (File, Home, Insert, Save, Undo) is never covered or intercepted by Android's Status Bar!
if (fs.existsSync(path.dirname(mainActivityPath))) {
  const javaCode = `package com.storytold.wordcraft;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
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
}
`;
  fs.writeFileSync(mainActivityPath, javaCode, 'utf8');
  console.log('✅ Configured MainActivity.java for Immersive Sticky Fullscreen (hides Status Bar)');
}
