$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
    $destination = Join-Path $env:LOCALAPPDATA 'LandmakerKakao'
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'LandmakerKakao.ps1') -Destination (Join-Path $destination 'LandmakerKakao.ps1') -Force
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '랜드메이커 카톡 점검.lnk'))
    $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
    $shortcut.Arguments = '-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "' + (Join-Path $destination 'LandmakerKakao.ps1') + '"'
    $shortcut.WorkingDirectory = $destination
    $shortcut.Save()
    [System.Windows.Forms.MessageBox]::Show('설치했습니다. 바탕화면의 랜드메이커 카톡 점검을 실행하세요. 이 버전은 읽기 가능 여부를 확인하며 자동 수집은 시작하지 않습니다.', '랜드메이커') | Out-Null
} catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '설치 실패') | Out-Null; exit 1 }
