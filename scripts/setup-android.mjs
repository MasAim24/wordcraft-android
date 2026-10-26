import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml');

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
