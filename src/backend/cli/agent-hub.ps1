# Agent Hub CLI - thin client over the REST API; the app must be running.
# Installed by cli-install.js into %LOCALAPPDATA%\AgentHub\bin (written with BOM: PS 5.1 reads BOM-less files as ANSI).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Base = if ($env:AGENT_HUB_URL) { $env:AGENT_HUB_URL } else { 'http://localhost:3737' }
$Api  = "$Base/api"

$Usage = @'
Uso:
  agent-hub projects
  agent-hub agents --project <nombre|id>
  agent-hub run --project <nombre|id> --agent <nombre> "<tarea>" [--max-turns N]

Variables: AGENT_HUB_URL (por defecto http://localhost:3737)
'@

function Fail($msg) { [Console]::Error.WriteLine("✗ $msg"); exit 1 }

function Req($method, $path, $body) {
  $params = @{ Method = $method; Uri = "$Api$path"; TimeoutSec = 1900 }
  if ($body) {
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
  }
  # Assign-then-emit: PS 5.1 writes a JSON array to the pipeline as one object; emitting the variable unrolls it.
  try { $res = Invoke-RestMethod @params; $res }
  catch {
    if (-not $_.Exception.Response) { Fail "No se puede conectar con Agent Hub en $Api. ¿Está la app abierta?" }
    $err = try { ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { $null }
    Fail $(if ($err) { $err } else { $_.Exception.Message })
  }
}

function Find-Project($ref) {
  if (-not $ref) { Fail 'Falta --project' }
  $all = @(Req GET '/projects' | Where-Object { $_ })
  $p = $all | Where-Object { $_.id -eq $ref } | Select-Object -First 1
  if (-not $p) { $p = $all | Where-Object { $_.name -eq $ref } | Select-Object -First 1 }  # -eq is case-insensitive
  if (-not $p) { Fail "Proyecto `"$ref`" no encontrado. Usa ``agent-hub projects``." }
  $p
}

# Manual parsing keeps the --long / -s syntax (PowerShell params would force -Project).
$opts = @{}; $pos = @()
for ($i = 0; $i -lt $args.Count; $i++) {
  switch -Regex ($args[$i]) {
    '^(--project|-p)$'   { $opts.project  = $args[++$i]; break }
    '^(--agent|-a)$'     { $opts.agent    = $args[++$i]; break }
    '^--max-turns$'      { $opts.maxTurns = [int]$args[++$i]; break }
    '^(--help|-h)$'      { $opts.help     = $true; break }
    default              { $pos += $args[$i] }
  }
}
$cmd = $pos | Select-Object -First 1
$rest = @($pos | Select-Object -Skip 1)

if ($opts.help -or -not $cmd) { Write-Output $Usage; exit 0 }

switch ($cmd) {
  'projects' {
    foreach ($p in @(Req GET '/projects' | Where-Object { $_ })) { Write-Output "$($p.id)  $($p.name)  [$($p.status)]  $($p.path)" }
  }
  'agents' {
    $p = Find-Project $opts.project
    # PS 5.1 turns an empty JSON array into @($null)
    $own = @(Req GET "/projects/$($p.id)/agents" | Where-Object { $_ })
    $applicable = @(Req GET "/agents/applicable?projectId=$($p.id)" | Where-Object { $_ })
    $seen = @{}
    foreach ($a in $own + $applicable) {
      if ($seen[$a.name]) { continue }
      $seen[$a.name] = $true
      $level = if ($own -contains $a) { 'project' } else { "$($a.level)" }
      Write-Output ('{0,-28} {1,-10} {2}' -f $a.name, $level, $a.description)
    }
  }
  'run' {
    $task = ($rest -join ' ').Trim()
    if (-not $opts.agent -or -not $task) { Fail 'Uso: agent-hub run --project <p> --agent <a> "<tarea>"' }
    $p = Find-Project $opts.project
    [Console]::Error.WriteLine("> Proyecto: $($p.name)`n> Agente: $($opts.agent)`n> Ejecutando…")
    $body = @{ agent = $opts.agent; task = $task }
    if ($opts.maxTurns) { $body.maxTurns = $opts.maxTurns }
    $r = Req POST "/projects/$($p.id)/run" $body
    if ($r.skills) { [Console]::Error.WriteLine("> Skills: $($r.skills -join ', ')") }
    if ($r.mcpIgnored) { [Console]::Error.WriteLine("! MCP no aplicado con $($r.provider): $($r.mcpIgnored -join ', ')") }
    Write-Output $r.result
    [Console]::Error.WriteLine(('✓ {0} · {1:N1}s' -f $r.provider, ($r.durationMs / 1000)))
  }
  default { Fail "Comando desconocido: $cmd`n`n$Usage" }
}
