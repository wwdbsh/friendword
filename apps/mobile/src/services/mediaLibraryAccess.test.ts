import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android' | 'web' }));
const picker = vi.hoisted(() => ({
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

vi.mock('react-native', () => ({
  get Platform() {
    return { OS: platform.os };
  },
}));
vi.mock('expo-image-picker', () => picker);

const { ensureVisualLibraryReadAccess } = await import('./mediaLibraryAccess');

describe('ensureVisualLibraryReadAccess', () => {
  beforeEach(() => {
    picker.requestMediaLibraryPermissionsAsync.mockClear();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  });

  it('does not ask iOS for photo library permission, because PHPicker needs none', async () => {
    platform.os = 'ios';

    await expect(ensureVisualLibraryReadAccess()).resolves.toEqual({ granted: true });
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('still asks Android, where the library read is permission-gated', async () => {
    platform.os = 'android';

    await expect(ensureVisualLibraryReadAccess()).resolves.toEqual({ granted: true });
    expect(picker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('reports an Android denial so the step can explain itself', async () => {
    platform.os = 'android';
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(ensureVisualLibraryReadAccess()).resolves.toEqual({ granted: false });
  });
});
