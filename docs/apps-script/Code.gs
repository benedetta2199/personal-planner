/**
 * Personal Planner — ponte Google Sheets/Drive via Apps Script.
 *
 * Gira con il TUO account Google: niente service account, chiavi JSON o OAuth.
 *
 * INSTALLAZIONE
 *  1. Apri il Google Sheet del bilancio → Estensioni → Apps Script.
 *  2. Cancella il contenuto di Codice.gs e incolla tutto questo file. Salva.
 *  3. Impostazioni progetto (icona ingranaggio) → Proprietà script → Aggiungi:
 *       APP_SECRET = una password lunga a caso (la stessa di APPS_SCRIPT_SECRET nell'app)
 *  4. Esegui una volta la funzione `autorizza` (menu a tendina in alto → Esegui)
 *     e accetta i permessi richiesti.
 *  5. Esegui il deployment → Nuovo deployment → tipo "App web":
 *       Esegui come: Me    ·    Chi ha accesso: Chiunque
 *     Copia l'URL che finisce con /exec → APPS_SCRIPT_URL nell'app.
 *
 * Quando modifichi questo codice: Esegui il deployment → Gestisci deployment →
 * modifica (matita) → Versione: Nuova versione. L'URL resta lo stesso.
 */

/** Versione del ponte: l'app la controlla prima di scrivere sul foglio. */
var VERSION = 2

function autorizza() {
  // Serve solo a far comparire la richiesta di permessi per Fogli e Drive.
  SpreadsheetApp.getActiveSpreadsheet()
  DriveApp.getRootFolder()
  Logger.log('Autorizzazione completata.')
}

function doGet() {
  return json_({ ok: true, message: 'Personal Planner bridge attivo. Usa POST.' })
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    var expected = PropertiesService.getScriptProperties().getProperty('APP_SECRET')
    if (!expected) return fail_('not_configured', 'Imposta la proprietà script APP_SECRET.')
    if (req.secret !== expected) return fail_('unauthorized', 'Segreto Apps Script non valido.')
    var handler = ACTIONS[req.action]
    if (!handler) return fail_('unknown_action', 'Azione non supportata: ' + req.action)
    var result = handler(req) || {}
    result.ok = true
    return json_(result)
  } catch (err) {
    var msg = String((err && err.message) || err)
    var code = /not found|non trovato|unable to find|impossibile trovare/i.test(msg) ? 'not_found' : 'script_error'
    return fail_(code, msg)
  }
}

var ACTIONS = {
  ping: function () {
    return { version: VERSION, spreadsheet: SpreadsheetApp.getActiveSpreadsheet() ? SpreadsheetApp.getActiveSpreadsheet().getName() : null }
  },

  /** Legge più schede (nome case-insensitive). Date → numero seriale come l'API Sheets. */
  read: function (req) {
    var ss = book_(req.spreadsheetId)
    var tz = ss.getSpreadsheetTimeZone()
    var byName = {}
    ss.getSheets().forEach(function (s) { byName[s.getName().trim().toLowerCase()] = s })
    var values = {}
    ;(req.sheets || []).forEach(function (name) {
      var sheet = byName[String(name).toLowerCase()]
      if (sheet) values[name] = trim_(sheet.getDataRange().getValues(), function (d) { return serial_(d, tz) })
    })
    return { title: ss.getName(), values: values }
  },

  /** Righe di una scheda (la prima se `tab` manca); la crea e scrive le intestazioni se richiesto. */
  'table.read': function (req) {
    var ss = book_(req.spreadsheetId)
    var sheet = req.tab ? ss.getSheetByName(req.tab) : ss.getSheets()[0]
    if (!sheet && req.create) {
      sheet = ss.insertSheet(req.tab)
      if (req.hidden) sheet.hideSheet()
    }
    if (!sheet) throw new Error('Scheda non trovata: ' + req.tab)
    var tz = ss.getSpreadsheetTimeZone()
    var rows = trim_(sheet.getDataRange().getValues(), function (d) { return iso_(d, tz) })
    if (!rows.length && req.headers && req.headers.length) {
      sheet.getRange(1, 1, 1, req.headers.length).setValues([req.headers])
      rows = [req.headers]
    }
    return { tab: sheet.getName(), rows: rows }
  },

  /** Scrive un blocco di valori a partire da (row, col), 1-based. */
  'range.put': function (req) {
    var sheet = tab_(req)
    var values = pad_(req.values)
    var range = sheet.getRange(req.row, req.col || 1, values.length, values[0].length)
    // text: true → testo puro (es. JSON), senza conversioni automatiche di Fogli.
    if (req.text) range.setNumberFormat('@')
    range.setValues(values)
    return {}
  },

  'rows.append': function (req) {
    var sheet = tab_(req)
    var values = pad_(req.values)
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values)
    return {}
  },

  'row.delete': function (req) {
    tab_(req).deleteRow(req.row)
    return {}
  },

  /** Trova o crea una cartella / un Google Sheet dentro una cartella. */
  'drive.ensure': function (req) {
    var parent = DriveApp.getFolderById(req.parentId)
    if (req.kind === 'folder') {
      var folders = parent.getFoldersByName(req.name)
      if (folders.hasNext()) return file_(folders.next(), false)
      return file_(parent.createFolder(req.name), true)
    }
    var files = parent.getFilesByName(req.name)
    while (files.hasNext()) {
      var f = files.next()
      if (f.getMimeType() === MimeType.GOOGLE_SHEETS) return file_(f, false)
    }
    var created = DriveApp.getFileById(SpreadsheetApp.create(req.name).getId())
    created.moveTo(parent)
    return file_(created, true)
  },

  /** PDF già caricato con la stessa impronta SHA-256 (salvata nella descrizione)? */
  'drive.findByHash': function (req) {
    var files = DriveApp.getFolderById(req.folderId).getFiles()
    while (files.hasNext()) {
      var f = files.next()
      if (f.getDescription() === 'sha256:' + req.hash) return { file: file_(f, false) }
    }
    return { file: null }
  },

  'drive.upload': function (req) {
    var blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mimeType || 'application/pdf', req.name)
    var f = DriveApp.getFolderById(req.folderId).createFile(blob)
    if (req.hash) f.setDescription('sha256:' + req.hash)
    return { file: file_(f, true) }
  },
}

// ---- Utilità ------------------------------------------------------------------

function book_(id) {
  if (id) return SpreadsheetApp.openById(id)
  var active = SpreadsheetApp.getActiveSpreadsheet()
  if (!active) throw new Error('Nessun foglio indicato e script non collegato a un foglio.')
  return active
}

function tab_(req) {
  var ss = book_(req.spreadsheetId)
  var sheet = req.tab ? ss.getSheetByName(req.tab) : ss.getSheets()[0]
  if (!sheet) throw new Error('Scheda non trovata: ' + req.tab)
  return sheet
}

function file_(f, created) {
  return { id: f.getId(), name: f.getName(), url: f.getUrl(), created: created }
}

/** Come l'API Sheets: niente celle vuote in coda alle righe né righe vuote in fondo. */
function trim_(rows, dateFn) {
  var out = rows.map(function (row) {
    var r = row.map(function (v) { return v instanceof Date ? dateFn(v) : v })
    while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === null)) r.pop()
    return r
  })
  while (out.length && !out[out.length - 1].length) out.pop()
  return out
}

/** { $date: 'yyyy-mm-dd' } → data vera di Fogli; il resto invariato. */
function cell_(v) {
  if (v && typeof v === 'object' && typeof v.$date === 'string') {
    var p = v.$date.split('-').map(Number)
    return new Date(p[0], p[1] - 1, p[2])
  }
  return v === null || v === undefined ? '' : v
}

function pad_(values) {
  var width = values.reduce(function (m, r) { return Math.max(m, r.length) }, 1)
  return values.map(function (r) {
    var c = r.map(cell_)
    while (c.length < width) c.push('')
    return c
  })
}

function parts_(d, tz) {
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd-HH-mm-ss').split('-').map(Number)
}

function serial_(d, tz) {
  var p = parts_(d, tz)
  return (Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - Date.UTC(1899, 11, 30)) / 86400000
}

function iso_(d, tz) {
  var p = parts_(d, tz)
  return p[3] || p[4] || p[5]
    ? Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ss")
    : Utilities.formatDate(d, tz, 'yyyy-MM-dd')
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function fail_(code, message) {
  return json_({ ok: false, code: code, message: message })
}
