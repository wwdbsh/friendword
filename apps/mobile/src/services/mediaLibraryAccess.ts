import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type MediaLibraryAccess = {
  readonly granted: boolean;
};

/**
 * Gate for *reading* the photo library through the system picker.
 *
 * On iOS 14+ `ImagePicker.launchImageLibraryAsync` runs `PHPickerViewController`
 * out of process: the picker itself needs no authorization, and the app only
 * receives the assets the introducer hands it. Calling
 * `requestMediaLibraryPermissionsAsync` there is what raises the "would like to
 * access your photo library (full access)" prompt, so we skip it — asking for
 * blanket library access we never use is both a worse first run and more access
 * than the pitch flow needs.
 *
 * Android still gates the library read behind a runtime permission, so the
 * request stays there.
 *
 * This helper is read-only on purpose. Nothing on mobile writes to or exports
 * into the photo library today (the MP4 kit is web-only); a path that does would
 * need its own write-access request rather than this one.
 */
export async function ensureVisualLibraryReadAccess(): Promise<MediaLibraryAccess> {
  if (Platform.OS === 'ios') {
    return { granted: true };
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return { granted: permission.granted };
}
