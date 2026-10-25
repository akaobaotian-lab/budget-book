/**
 * Windows のデスクトップに「家計簿」のショートカットを作るファイル（.cmd）を生成する。
 * ダブルクリックすると、アプリ専用ウィンドウで開くショートカットがデスクトップにできる。
 */

/** PowerShell の文字列リテラル（シングルクォート）に埋め込む */
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function windowsShortcutPowerShell(appUrl: string, iconUrl: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$url = ${psQuote(appUrl)}`,
    "$dir = Join-Path $env:LOCALAPPDATA 'Kakeibo'",
    'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    "$ico = Join-Path $dir 'kakeibo.ico'",
    `try { Invoke-WebRequest -UseBasicParsing -Uri ${psQuote(iconUrl)} -OutFile $ico } catch { }`,
    // Chrome があれば Chrome、なければ Windows に標準で入っている Edge で開く
    '$browsers = @(',
    // 32ビット版 Windows などで存在しないフォルダがあっても止まらないよう、文字列で組み立てる
    '  "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",',
    '  "${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe",',
    '  "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe",',
    '  "${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe",',
    '  "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe"',
    ')',
    '$browser = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1',
    // OneDrive でデスクトップを同期している場合も正しい場所に作る
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    'if ($browser) {',
    '  $shell = New-Object -ComObject WScript.Shell',
    `  $lnk = $shell.CreateShortcut((Join-Path $desktop ${psQuote('家計簿.lnk')}))`,
    '  $lnk.TargetPath = $browser',
    '  $lnk.Arguments = "--app=$url"',
    `  $lnk.Description = ${psQuote('家計簿')}`,
    '  if (Test-Path $ico) { $lnk.IconLocation = "$ico,0" }',
    '  $lnk.Save()',
    '} else {',
    // ブラウザが見つからない場合は、既定のブラウザで開くインターネットショートカットにする
    `  $file = Join-Path $desktop ${psQuote('家計簿.url')}`,
    '  $body = "[InternetShortcut]`r`nURL=$url`r`n"',
    '  if (Test-Path $ico) { $body += "IconFile=$ico`r`nIconIndex=0`r`n" }',
    '  Set-Content -Path $file -Value $body -Encoding Default',
    '}',
  ].join('\r\n');
}

/** PowerShell の -EncodedCommand 用（UTF-16LE を Base64） */
export function encodePowerShell(script: string): string {
  const bytes = new Uint8Array(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bytes[i * 2] = c & 0xff;
    bytes[i * 2 + 1] = c >> 8;
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * ダブルクリックで実行する .cmd ファイルの中身。
 * コマンドプロンプトの文字コードに左右されないよう、日本語を含む処理は PowerShell 側にエンコードして渡す。
 */
export function windowsShortcutCmd(appUrl: string, iconUrl: string): string {
  const encoded = encodePowerShell(windowsShortcutPowerShell(appUrl, iconUrl));
  return [
    '@echo off',
    'echo Creating the Kakeibo shortcut on your desktop...',
    `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
    'if errorlevel 1 (',
    '  echo Failed to create the shortcut.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo Done. You can delete this file.',
    'timeout /t 4 >nul',
    '',
  ].join('\r\n');
}
