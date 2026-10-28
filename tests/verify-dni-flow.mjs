#!/usr/bin/env node
/**
 * Plan de pruebas E2E: DNI como identidad + historial clínico.
 *
 * Uso:
 *   1. npm run dev
 *   2. npm run test:dni
 *
 * Opciones:
 *   TEST_BASE_URL=http://localhost:3010 npm run test:dni   (otro puerto)
 *   npm run test:dni -- --keep                              (no borra los datos de prueba)
 */
import fs from 'node:fs'
import pg from 'pg'

const BASE = (process.env.TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const API = `${BASE}/api`
const KEEP = process.argv.includes('--keep')

// Cada login usa una IP simulada distinta para no chocar con el rate limit
// (5 intentos/minuto). El caso C07 prueba el límite a propósito.
const IP_BASE = `10.61.${Math.floor(Math.random() * 200) + 1}`
let ipCounter = 0
const nextIp = () => `${IP_BASE}.${++ipCounter}`
const DEFAULT_IP = nextIp()

const created = { userIds: new Set() }
const state = { patientId: null, dni: null, password: 'Prueba@2025!', token: null, name: null }
let passed = 0
let failed = 0
let currentSuite = ''

function suite(name) {
  currentSuite = name
  console.log(`\n${name}`)
}
function pass(id, label) {
  passed++
  console.log(`  PASS  ${id}  ${label}`)
}
function fail(id, label, detail) {
  failed++
  console.log(`  FAIL  ${id}  ${label}`)
  if (detail !== undefined) console.log('        ' + JSON.stringify(detail))
}
function check(id, label, condition, detail) {
  condition ? pass(id, label) : fail(id, label, detail)
}
async function api(path, { method = 'GET', body, token, ip } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip || DEFAULT_IP,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}
function futureDates(count = 12) {
  const dates = []
  for (let i = 3; i < 3 + count; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    if (d.getDay() === 0) continue // domingo: sin agenda
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}
async function findSlot(doctorId) {
  for (const date of futureDates()) {
    const availability = await api(`/doctors/${doctorId}/availability?date=${date}`)
    const slot = (availability.json.slots || []).find(s => s.available)
    if (slot) return { date, ...slot }
  }
  return null
}

/* ---------------- limpieza ---------------- */
function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .find(l => l.trim().startsWith('DATABASE_URL='))
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
  }
  return null
}
async function cleanup() {
  const url = connectionString()
  if (!url) {
    console.log('\nNo encontré DATABASE_URL: no pude borrar los datos de prueba.')
    return
  }
  const pool = new pg.Pool({ connectionString: url })
  const removed = { appointments: 0, whatsapp_requests: 0, clinical_records: 0, users: 0 }
  try {
    for (const id of created.userIds) {
      for (const collection of ['appointments', 'whatsapp_requests', 'clinical_records']) {
        const res = await pool.query(
          `DELETE FROM documents WHERE collection = $1 AND data->>'patientId' = $2`,
          [collection, id],
        )
        removed[collection] += res.rowCount
      }
      const res = await pool.query(`DELETE FROM documents WHERE collection = 'users' AND id = $1`, [id])
      removed.users += res.rowCount
    }
    console.log(`\nLimpieza: ${removed.users} usuario(s), ${removed.appointments} turno(s), ` +
      `${removed.whatsapp_requests} solicitud(es) y ${removed.clinical_records} evolución(es) eliminados.`)
  } finally {
    await pool.end()
  }
}

/* ---------------- ejecución ---------------- */
let health
try {
  health = await fetch(`${API}/health`)
} catch {
  console.error(`\nNo pude conectar con ${BASE}.`)
  console.error('Iniciá el servidor con "npm run dev" y volvé a ejecutar "npm run test:dni".\n')
  process.exit(1)
}

console.log('\nPLAN DE PRUEBAS: DNI + HISTORIAL CLÍNICO')
console.log(`Entorno: ${BASE}`)
console.log(`Node: ${process.version} | Fecha: ${new Date().toISOString()}`)

try {
  /* ================= A. PREPARACIÓN ================= */
  suite('A. Preparación')
  const healthJson = await health.json().catch(() => ({}))
  check('A01', 'La API responde /health', health.ok && healthJson.ok === true, { status: health.status })

  /* ================= B. AUTENTICACIÓN ================= */
  suite('B. Autenticación')
  const demo = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { dni: '35678910', password: 'Paciente@2025!' } })
  check('B01', 'Paciente demo ingresa con DNI', demo.status === 200 && !!demo.json.token, demo.json)
  check('B02', 'La respuesta devuelve el DNI descifrado', demo.json.user?.dni === '35678910', demo.json.user)
  const demoPatientId = demo.json.user?.id

  const reception = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { dni: '30111222', password: 'Recepcion@2025!' } })
  check('B03', 'Recepción ingresa con DNI', reception.status === 200 && reception.json.user?.role === 'reception', reception.json)
  check('B04', 'Recepción devuelve su DNI', reception.json.user?.dni === '30111222', reception.json.user)

  const patient2 = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { dni: '35000013', password: 'Paciente@2025!' } })
  check('B05', 'Paciente del seed ingresa con DNI generado', patient2.status === 200, patient2.json)

  const admin = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { email: 'admin@clinicabuenasalud.com', password: 'Admin@2025!' } })
  check('B06', 'Admin con email exige 2FA', admin.status === 200 && admin.json.require2FA === true, admin.json)

  const doctor = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { email: 'dr.rossi@clinicabuenasalud.com', password: 'Doctor@2025!' } })
  check('B07', 'Médico con email exige 2FA', doctor.status === 200 && doctor.json.require2FA === true, doctor.json)

  const unknown = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { dni: '99999999', password: 'Cualquiera@2025!' } })
  check('B08', 'DNI inexistente devuelve 401', unknown.status === 401, unknown.json)

  const patientEmailLogin = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { email: 'paciente@ejemplo.com', password: 'Paciente@2025!' } })
  check('B09', 'Paciente no puede ingresar con email', patientEmailLogin.status === 400, patientEmailLogin.json)

  const receptionEmailLogin = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { email: 'recepcion@clinicabuenasalud.com', password: 'Recepcion@2025!' } })
  check('B10', 'Recepción no puede ingresar con email', receptionEmailLogin.status === 400, receptionEmailLogin.json)

  /* ================= C. WHATSAPP / FICHA POR DNI ================= */
  suite('C. Solicitudes de WhatsApp y ficha por DNI')
  const run = String(Date.now()).slice(-7)
  state.dni = `9${run}`
  state.name = `Paciente E2E ${run}`
  const specialties = await api('/specialties')
  const branches = await api('/branches')
  const specialtyId = specialties.json.specialties?.[0]?.id || ''
  const branchId = branches.json.branches?.[0]?.id || ''

  const waBody = {
    name: state.name, dni: state.dni, phone: '+54 9 11 5555-0000',
    specialtyId, branchId, preferred: 'Mañana por la tarde', message: 'Solicitud de prueba E2E',
  }
  const wa1 = await api('/whatsapp-requests', { method: 'POST', ip: nextIp(), body: waBody })
  check('C01', 'Solicitud con DNI crea la ficha', wa1.status === 201 && !!wa1.json.patient?.id, wa1.json)
  state.patientId = wa1.json.patient?.id || null
  if (state.patientId) created.userIds.add(state.patientId)
  check('C02', 'La ficha nace sin cuenta', wa1.json.patient?.hasAccount === false, wa1.json.patient)

  const wa2 = await api('/whatsapp-requests', { method: 'POST', ip: nextIp(), body: waBody })
  check('C03', 'Segunda solicitud reutiliza el mismo paciente', wa2.status === 201 && wa2.json.patient?.id === state.patientId, {
    first: state.patientId, second: wa2.json.patient?.id,
  })

  const waNoDni = await api('/whatsapp-requests', { method: 'POST', ip: nextIp(), body: { ...waBody, dni: '' } })
  check('C04', 'Solicitud sin DNI devuelve 400', waNoDni.status === 400, waNoDni.json)

  const stubLogin = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { dni: state.dni, password: state.password } })
  check('C05', 'Ficha sin cuenta no puede ingresar', stubLogin.status === 403 && stubLogin.json.needsRegistration === true, stubLogin.json)

  const preClaimList = await api('/whatsapp-requests', { token: reception.json.token })
  const preClaim = (preClaimList.json.requests || []).find(r => r.patientId === state.patientId)
  check('C06', 'La bandeja marca cuenta pendiente antes del reclamo', preClaim?.patientHasAccount === false, preClaim)

  /* ================= D. REGISTRO Y RECLAMO ================= */
  suite('D. Registro y reclamo de historial')
  const weak = await api('/auth/register', { method: 'POST', ip: nextIp(), body: {
    name: 'Prueba Débil', dni: `8${run}`, password: 'corta',
  } })
  check('D01', 'Contraseña débil devuelve 400', weak.status === 400, weak.json)

  const invalidDni = await api('/auth/register', { method: 'POST', ip: nextIp(), body: {
    name: 'Prueba DNI', dni: '123', password: state.password,
  } })
  check('D02', 'DNI inválido devuelve 400', invalidDni.status === 400, invalidDni.json)

  const register = await api('/auth/register', { method: 'POST', ip: nextIp(), body: {
    name: state.name, dni: state.dni, password: state.password, phone: '+54 9 11 5555-0000',
  } })
  check('D03', 'Registro con DNI (email opcional omitido)', register.status === 201, register.json)
  check('D04', 'Reclama el historial existente', register.json.claimedHistory === true, register.json)
  check('D05', 'Conserva el mismo patientId', register.json.user?.id === state.patientId, {
    got: register.json.user?.id, expected: state.patientId,
  })
  state.token = register.json.token

  const duplicate = await api('/auth/register', { method: 'POST', ip: nextIp(), body: {
    name: state.name, dni: state.dni, password: state.password,
  } })
  check('D06', 'DNI ya registrado devuelve 409', duplicate.status === 409, duplicate.json)

  const duplicateEmail = await api('/auth/register', { method: 'POST', ip: nextIp(), body: {
    name: 'Otro Paciente', dni: `6${run}`, email: 'paciente@ejemplo.com', password: state.password,
  } })
  check('D07', 'Email de otra cuenta devuelve 409', duplicateEmail.status === 409, duplicateEmail.json)

  const wrongPassword = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { dni: state.dni, password: 'Incorrecta@2025!' } })
  check('D08', 'Contraseña incorrecta devuelve 401', wrongPassword.status === 401, wrongPassword.json)

  const login = await api('/auth/login', { method: 'POST', ip: nextIp(), body: { dni: state.dni, password: state.password } })
  check('D09', 'Login con DNI reclamado', login.status === 200 && login.json.user?.dni === state.dni, login.json)

  /* ================= E. TURNOS ================= */
  suite('E. Turnos y DNI')
  const doctors = await api('/doctors')
  const doctorRow = (doctors.json.doctors || []).find(d => d.branchIds?.length)
  check('E01', 'Hay médicos con agenda', !!doctorRow, doctors.json)

  let appointment1 = null
  let slot1 = null
  if (doctorRow) {
    slot1 = await findSlot(doctorRow.id)
    if (slot1) {
      const res = await api('/appointments', { method: 'POST', token: state.token, body: {
        doctorId: doctorRow.id, branchId: slot1.branchId || doctorRow.branchIds[0],
        date: slot1.date, startTime: slot1.startTime, endTime: slot1.endTime,
        patientDni: state.dni, notes: 'Reserva E2E',
      } })
      appointment1 = res.json.appointment || null
      check('E02', 'Paciente reserva turno con su DNI', res.status === 200 || res.status === 201, res.json)
    } else {
      fail('E02', 'Paciente reserva turno con su DNI', 'sin horarios disponibles')
    }
  } else {
    fail('E02', 'Paciente reserva turno con su DNI', 'sin médicos')
  }

  if (slot1 && doctorRow) {
    const overlap = await api('/appointments', { method: 'POST', token: state.token, body: {
      doctorId: doctorRow.id, branchId: slot1.branchId || doctorRow.branchIds[0],
      date: slot1.date, startTime: slot1.startTime, endTime: slot1.endTime,
      patientDni: state.dni,
    } })
    check('E03', 'Horario ocupado devuelve 409', overlap.status === 409, overlap.json)
  } else {
    fail('E03', 'Horario ocupado devuelve 409', 'sin slot previo')
  }

  const unauthBooking = await api('/appointments', { method: 'POST', body: {
    doctorId: doctorRow?.id, branchId: doctorRow?.branchIds?.[0],
    date: slot1?.date || futureDates()[0], startTime: '08:00', endTime: '08:30',
    patientDni: state.dni,
  } })
  check('E04', 'Reserva sin sesión devuelve 401', unauthBooking.status === 401, unauthBooking.json)

  const invalidRange = await api('/appointments', { method: 'POST', token: state.token, body: {
    doctorId: doctorRow?.id, branchId: doctorRow?.branchIds?.[0],
    date: futureDates()[0], startTime: '10:00', endTime: '09:00',
    patientDni: state.dni,
  } })
  check('E05', 'Horario invertido devuelve 400', invalidRange.status === 400, invalidRange.json)

  let appointment2 = null
  if (doctorRow) {
    const slot2 = await findSlot(doctorRow.id)
    if (slot2) {
      // Intento de suplantación: el paciente envía el DNI de otra persona.
      const res = await api('/appointments', { method: 'POST', token: state.token, body: {
        doctorId: doctorRow.id, branchId: slot2.branchId || doctorRow.branchIds[0],
        date: slot2.date, startTime: slot2.startTime, endTime: slot2.endTime,
        patientId: demoPatientId, patientDni: '35678910', patientName: 'Intento Suplantación',
        notes: 'Reserva E2E 2',
      } })
      appointment2 = res.json.appointment || null
      check('E06', 'Paciente no puede reservar con otro DNI', res.status === 200 || res.status === 201, res.json)
      check('E07', 'El turno conserva el DNI del paciente logueado', appointment2?.patientDni === state.dni, appointment2)
      check('E08', 'El turno conserva el nombre del paciente logueado', appointment2?.patientName === state.name, appointment2)
    } else {
      fail('E06', 'Paciente no puede reservar con otro DNI', 'sin horarios disponibles')
    }
  }

  // Recepción reserva para el paciente usando DNI
  if (doctorRow) {
    const slot3 = await findSlot(doctorRow.id)
    if (slot3) {
      const res = await api('/appointments', { method: 'POST', token: reception.json.token, body: {
        doctorId: doctorRow.id, branchId: slot3.branchId || doctorRow.branchIds[0],
        date: slot3.date, startTime: slot3.startTime, endTime: slot3.endTime,
        patientDni: state.dni, patientName: state.name, patientPhone: '+54 9 11 5555-0000',
        notes: 'Reserva E2E recepción',
      } })
      check('E09', 'Recepción reserva para un DNI existente', res.status === 200 || res.status === 201, res.json)
      check('E10', 'El turno de recepción queda ligado al paciente', res.json.appointment?.patientId === state.patientId, res.json.appointment)
    } else {
      fail('E09', 'Recepción reserva para un DNI existente', 'sin horarios disponibles')
    }
  }

  if (appointment2) {
    const cancel = await api(`/appointments/${appointment2.id}`, { method: 'PATCH', token: state.token, body: { status: 'cancelled' } })
    check('E11', 'Paciente cancela su propio turno', cancel.status === 200 && cancel.json.appointment?.status === 'cancelled', cancel.json)

    const forbidden = await api(`/appointments/${appointment2.id}`, { method: 'PATCH', token: state.token, body: { status: 'attended' } })
    check('E12', 'Paciente no puede marcar su turno como atendido', forbidden.status === 403, forbidden.json)
  } else {
    fail('E11', 'Paciente cancela su propio turno', 'sin turno 2')
    fail('E12', 'Paciente no puede marcar su turno como atendido', 'sin turno 2')
  }

  /* ================= F. HISTORIAL CLÍNICO ================= */
  suite('F. Historial clínico y permisos')
  const history = await api('/clinical-history', { token: state.token })
  check('F01', 'Paciente accede a su historial', history.status === 200, history.json)
  check('F02', 'Incluye las solicitudes de WhatsApp', (history.json.whatsappRequests?.length || 0) >= 2, history.json.summary)
  check('F03', 'Incluye los turnos', (history.json.appointments?.length || 0) >= 3, history.json.summary)
  check('F04', 'Incluye el turno cancelado', (history.json.appointments || []).some(a => a.status === 'cancelled'), {
    statuses: (history.json.appointments || []).map(a => a.status),
  })
  check('F05', 'Marca la cuenta como activa', history.json.summary?.hasAccount === true, history.json.summary)
  check('F06', 'Los turnos conservan el DNI', (history.json.appointments || []).every(a => a.patientDni === state.dni), {
    dnis: (history.json.appointments || []).map(a => a.patientDni),
  })

  check('F12', 'El resumen cuenta las solicitudes de WhatsApp', (history.json.summary?.whatsappRequests || 0) >= 2, history.json.summary)

  const scoped = await api(`/clinical-history?patientId=${demoPatientId}`, { token: state.token })
  check('F07', 'Un paciente no puede leer otro historial', scoped.json.patient?.id === state.patientId, {
    got: scoped.json.patient?.id, expected: state.patientId,
  })

  const staffHistory = await api(`/clinical-history?patientId=${state.patientId}`, { token: reception.json.token })
  check('F08', 'Recepción consulta el historial', staffHistory.status === 200 && staffHistory.json.patient?.id === state.patientId, staffHistory.json)

  const patientCreate = await api('/clinical-records', { method: 'POST', token: state.token, body: {
    patientId: state.patientId, reason: 'No permitido',
  } })
  check('F09', 'Paciente no puede crear evoluciones', patientCreate.status === 403, patientCreate.json)

  const receptionCreate = await api('/clinical-records', { method: 'POST', token: reception.json.token, body: {
    patientId: state.patientId, reason: 'No permitido',
  } })
  check('F10', 'Recepción no puede crear evoluciones', receptionCreate.status === 403, receptionCreate.json)

  const unauthCreate = await api('/clinical-records', { method: 'POST', body: {
    patientId: state.patientId, reason: 'No permitido',
  } })
  check('F11', 'Sin sesión no se pueden crear evoluciones', unauthCreate.status === 401, unauthCreate.json)

  /* ================= G. BANDEJA DE SOLICITUDES ================= */
  suite('G. Bandeja de solicitudes')
  const patientList = await api('/whatsapp-requests', { token: state.token })
  check('G01', 'Paciente no puede listar solicitudes', patientList.status === 403, patientList.json)

  const staffList = await api('/whatsapp-requests', { token: reception.json.token })
  check('G02', 'Recepción lista solicitudes', staffList.status === 200, staffList.json)
  const mine = (staffList.json.requests || []).filter(r => r.patientId === state.patientId)
  check('G03', 'Las solicitudes quedan ligadas al paciente', mine.length >= 2, { found: mine.length })
  check('G04', 'La bandeja refleja la cuenta activa tras el reclamo', mine.length >= 2 && mine.every(r => r.patientHasAccount === true), {
    values: mine.map(r => r.patientHasAccount),
  })

  const beforeCount = staffList.json.requests?.length || 0
  const honeypot = await api('/whatsapp-requests', { method: 'POST', ip: nextIp(), body: {
    ...waBody, dni: `5${run}`, name: 'Bot', website: 'https://spam.example',
  } })
  const afterList = await api('/whatsapp-requests', { token: reception.json.token })
  check('G05', 'Honeypot responde OK sin guardar', honeypot.status === 200 && honeypot.json.ok === true, honeypot.json)
  check('G06', 'El honeypot no crea registros', (afterList.json.requests?.length || 0) === beforeCount, {
    before: beforeCount, after: afterList.json.requests?.length,
  })

  const rateIp = `${IP_BASE}.250`
  const rateStatuses = []
  const rateDni = `7${run}`
  for (let i = 0; i < 6; i++) {
    const res = await api('/whatsapp-requests', { method: 'POST', ip: rateIp, body: {
      ...waBody, dni: rateDni, name: `Paciente Rate ${run}`,
    } })
    rateStatuses.push(res.status)
    if (res.status === 201 && res.json.patient?.id) created.userIds.add(res.json.patient.id)
  }
  check('G07', 'Rate limit de solicitudes (5 permitidas)', rateStatuses.slice(0, 5).every(s => s === 201) && rateStatuses[5] === 429, rateStatuses)

  /* ================= H. MIGRACIÓN / DATOS ================= */
  suite('H. Migración y datos existentes')
  check('H01', 'Las cuentas demo tienen DNI reconstruido', demo.json.user?.dni === '35678910' && reception.json.user?.dni === '30111222', {
    patient: demo.json.user?.dni, reception: reception.json.user?.dni,
  })
  check('H02', 'La cuenta reclamada tiene dniHash y DNI', !!login.json.user?.dniHash, login.json.user)
  check('H03', 'La ficha sin cuenta no expone contraseña', !('password' in (wa1.json.patient || {})), wa1.json.patient)
} catch (error) {
  fail('X01', 'Error inesperado durante la ejecución', error.message)
} finally {
  if (KEEP) {
    console.log('\nDatos de prueba conservados (--keep):')
    console.log(`  DNI:        ${state.dni}`)
    console.log(`  Contraseña: ${state.password}`)
    console.log(`  patientId:  ${state.patientId}`)
  } else {
    await cleanup()
  }

  console.log(`\nRESUMEN: ${passed} OK, ${failed} fallido(s)`)
  process.exit(failed === 0 ? 0 : 1)
}
