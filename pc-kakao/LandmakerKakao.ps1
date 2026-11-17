$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = '랜드메이커 · PC 카톡 읽기 점검'
$form.Size = New-Object System.Drawing.Size(840, 670)
$form.StartPosition = 'CenterScreen'
$label = New-Object System.Windows.Forms.Label
$label.Text = 'PC 카톡의 지정 업무방을 별도 창으로 열고 창 목록을 새로고침하세요. 이 프로그램은 메시지를 보내거나 입력하지 않습니다.'
$label.Location = New-Object System.Drawing.Point(15, 15)
$label.Size = New-Object System.Drawing.Size(790, 45)
$form.Controls.Add($label)
$windows = New-Object System.Windows.Forms.ComboBox
$windows.DropDownStyle = 'DropDownList'
$windows.DisplayMember = 'Title'
$windows.Location = New-Object System.Drawing.Point(15, 65)
$windows.Size = New-Object System.Drawing.Size(590, 30)
$form.Controls.Add($windows)
$refresh = New-Object System.Windows.Forms.Button
$refresh.Text = '창 목록 새로고침'
$refresh.Location = New-Object System.Drawing.Point(620, 63)
$refresh.Size = New-Object System.Drawing.Size(175, 30)
$form.Controls.Add($refresh)
$inspect = New-Object System.Windows.Forms.Button
$inspect.Text = '선택 업무방 읽기 점검'
$inspect.Location = New-Object System.Drawing.Point(15, 110)
$inspect.Size = New-Object System.Drawing.Size(235, 35)
$form.Controls.Add($inspect)
$export = New-Object System.Windows.Forms.Button
$export.Text = '읽기 결과 JSON 저장'
$export.Location = New-Object System.Drawing.Point(265, 110)
$export.Size = New-Object System.Drawing.Size(235, 35)
$export.Enabled = $false
$form.Controls.Add($export)
$status = New-Object System.Windows.Forms.Label
$status.Text = '실시간 연결 전 점검 단계입니다. 전체 대화 수집 가능 여부는 확인 전입니다.'
$status.Location = New-Object System.Drawing.Point(15, 155)
$status.Size = New-Object System.Drawing.Size(780, 45)
$form.Controls.Add($status)
$preview = New-Object System.Windows.Forms.TextBox
$preview.Multiline = $true
$preview.ReadOnly = $true
$preview.ScrollBars = 'Both'
$preview.Location = New-Object System.Drawing.Point(15, 205)
$preview.Size = New-Object System.Drawing.Size(780, 395)
$preview.Anchor = 'Top,Bottom,Left,Right'
$form.Controls.Add($preview)
$script:result = $null
$refresh.Add_Click({
    $windows.Items.Clear()
    $seen = @{}
    foreach ($process in @(Get-Process -Name 'KakaoTalk' -ErrorAction SilentlyContinue)) {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$process.Id)
        foreach ($element in [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)) {
            try {
                $name = $element.Current.Name
                $handle = $element.Current.NativeWindowHandle
                if ($name -and -not $seen.ContainsKey($handle)) {
                    $seen[$handle] = $true
                    [void]$windows.Items.Add([PSCustomObject]@{ Title = $name; Element = $element })
                }
            } catch {}
        }
    }
    if ($windows.Items.Count) { $windows.SelectedIndex = 0; $status.Text = '연결할 업무방 창을 직접 선택하세요. 카톡 메인 창은 선택하지 마세요.' }
    else { $status.Text = '카톡 창을 찾지 못했습니다. 카톡 로그인 후 업무방을 별도 창으로 여세요.' }
    $export.Enabled = $false
    $script:result = $null
})
$inspect.Add_Click({
    if (-not $windows.SelectedItem) { $status.Text = '먼저 업무방 창을 선택하세요.'; return }
    try {
        $element = $windows.SelectedItem.Element
        $segments = [System.Collections.Generic.List[string]]::new()
        $documentCount = 0
        $nodes = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $limit = [Math]::Min($nodes.Count, 5000)
        for ($i = 0; $i -lt $limit; $i++) {
            $node = $nodes.Item($i)
            try {
                if ($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) {
                    $pattern = $null
                    if ($node.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
                        $text = $pattern.DocumentRange.GetText(100000)
                        if ($text.Trim()) { $segments.Add($text); $documentCount++ }
                    }
                }
            } catch {}
        }
        $raw = ($segments | Select-Object -Unique) -join "`r`n`r`n"
        $script:result = [ordered]@{ format = 'landmaker-kakao-probe-v1'; capturedAt = (Get-Date).ToUniversalTime().ToString('o'); room = $windows.SelectedItem.Title; scannedControls = $limit; readableDocuments = $documentCount; rawText = $raw; automaticCollection = $false }
        $preview.Text = $raw
        if ($raw.Trim()) { $status.Text = '문서 텍스트를 읽었습니다. 실제 대화인지 미리보기로 확인하세요. 전체 대화·작성자·시간 수집은 아직 검증되지 않았습니다.' }
        else { $status.Text = '이 카톡 창에서는 대화 본문 읽기를 확인하지 못했습니다. 카톡 TXT 내보내기로 가져올 수 있습니다.' }
        $export.Enabled = $true
    } catch { $status.Text = '읽기 점검 실패: ' + $_.Exception.Message; $export.Enabled = $false }
})
$export.Add_Click({
    if ($null -eq $script:result) { return }
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter = 'JSON (*.json)|*.json'
    $dialog.FileName = 'landmaker-kakao-probe.json'
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $script:result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $dialog.FileName -Encoding UTF8
        $status.Text = '저장했습니다. 랜드메이커 PC 카톡 메뉴에서 JSON을 가져와 확인하세요.'
    }
})
$form.Add_Shown({ $refresh.PerformClick() })
[void]$form.ShowDialog()
