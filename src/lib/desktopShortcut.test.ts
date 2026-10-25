import { describe, expect, it } from 'vitest';
import { windowsShortcutCmd, windowsShortcutPowerShell } from './desktopShortcut';

const URL_ = 'https://akaobaotian-lab.github.io/budget-book/';
const ICON = 'https://akaobaotian-lab.github.io/budget-book/icons/kakeibo.ico';

/** .cmd に埋め込まれた PowerShell を取り出して UTF-16LE で復号 */
function decode(cmd: string): string {
  const b64 = cmd.match(/-EncodedCommand (\S+)/)![1];
  return Buffer.from(b64, 'base64').toString('utf16le');
}

describe('windows desktop shortcut', () => {
  it('embeds the script losslessly, including the Japanese file name', () => {
    const cmd = windowsShortcutCmd(URL_, ICON);
    expect(decode(cmd)).toBe(windowsShortcutPowerShell(URL_, ICON));
    expect(decode(cmd)).toContain("'家計簿.lnk'");
  });
  it('keeps the .cmd itself ASCII with CRLF line endings', () => {
    const cmd = windowsShortcutCmd(URL_, ICON);
    expect(/^[\x00-\x7f]*$/.test(cmd)).toBe(true);
    expect(cmd.split('\r\n').length).toBeGreaterThan(5);
    expect(cmd.replace(/\r\n/g, '')).not.toContain('\n');
    // cmd.exe の1行の上限(8191文字)に収まる
    expect(Math.max(...cmd.split('\r\n').map((l) => l.length))).toBeLessThan(8000);
  });
  it('opens the app in its own window and quotes URLs safely', () => {
    const ps = windowsShortcutPowerShell("https://x/it's/", ICON);
    expect(ps).toContain("$url = 'https://x/it''s/'");
    expect(ps).toContain('"--app=$url"');
    expect(ps).toContain("GetFolderPath('Desktop')");
  });
});
