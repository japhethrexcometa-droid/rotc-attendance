$releases = Invoke-RestMethod 'https://api.github.com/repos/supabase/cli/releases/latest'
$asset = $releases.assets | Where-Object { $_.name -eq 'supabase_windows_amd64.tar.gz' }
$url = $asset.browser_download_url
Write-Output "Selected asset: $($asset.name)"
Write-Output "URL: $url"
Write-Output "Downloading from $url"
$tar = $asset.name
Invoke-WebRequest -Uri $url -OutFile $tar
tar -xf $tar
# Move supabase.exe from extracted folder
$extractedDirs = Get-ChildItem -Directory | Where-Object { $_.Name -like '*supabase*' }
foreach ($dir in $extractedDirs) {
  $exe = Join-Path $dir.FullName 'supabase.exe'
  if (Test-Path $exe) {
    Move-Item $exe . -Force
    Remove-Item $dir.FullName -Recurse -Force
  }
}
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Write-Output 'Supabase CLI installed. Version:'
.\supabase.exe --version
