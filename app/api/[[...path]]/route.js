import { NextResponse } from 'next/server'
import { getDb } from '@/lib/postgres'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import QRCode from 'qrcode'
import {
  hashPassword, verifyPassword, passwordStrong,
  signToken, verifyToken, encrypt, decrypt,
  generateTotpSecret, totpUri, verifyTotp, generateRecoveryCodes,
  rateLimit, clientIp, hashDni, normalizeDni,
} from '@/lib/security'
import { DEFAULT_WHATSAPP_NUMBER, buildAppointmentRequestMessage, buildWaUrl } from '@/lib/whatsapp'

/* ================= helpers ================= */
const ok = (data, status = 200) => NextResponse.json(data, { status })
const err = (message, status = 400, extra = {}) => NextResponse.json({ error: message, ...extra }, { status })
const badZod = (e) => err(e.errors?.[0]?.message || 'Datos inválidos', 400, { issues: e.errors })

const SENSITIVE_ROLES_2FA = ['admin', 'doctor']
const APPT_MIN_HOURS_AHEAD = 2
const SEED_SECRET = process.env.SEED_SECRET || ''
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || ''
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER

/* ---------- Cloudflare Turnstile (CAPTCHA) ---------- */
async function verifyCaptcha(token) {
  if (!TURNSTILE_SECRET) return true // CAPTCHA no configurado (entorno dev) → no bloquea
  if (!token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token) }),
    })
    const data = await res.json()
    return !!data.success
  } catch { return false }
}

/** Interpret user-submitted (date, startTime) as Argentina local time.
 *  Return absolute UTC ms of that moment. Argentina is UTC-3 (no DST). */
function argentinaLocalToUtcMs(dateStr, timeStr) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const [h, m] = timeStr.split(':').map(Number)
  // Argentina local h = UTC (h+3). Date.UTC gives absolute ms.
  return Date.UTC(Y, M - 1, D, h + 3, m, 0)
}
/** Return absolute UTC ms of "now" (Argentina and UTC clocks share the same instant). */
function nowMs() { return Date.now() }

/* Encrypt/decrypt sensitive fields on the fly */
const SENSITIVE_APPT = ['patientPhone', 'patientDni', 'notes']
const SENSITIVE_USER = ['phone', 'dni', 'address']
const SENSITIVE_RECORD = ['reason', 'diagnosis', 'treatment', 'notes']
const SENSITIVE_WA = ['dni', 'phone', 'preferred', 'message']
function encryptFields(obj, fields) {
  const out = { ...obj }
  for (const f of fields) if (out[f]) out[f] = encrypt(out[f])
  return out
}
function decryptFields(obj, fields) {
  if (!obj) return obj
  const out = { ...obj }
  for (const f of fields) if (out[f]) out[f] = decrypt(out[f])
  return out
}

/** Busca un usuario por DNI. El DNI está cifrado, por eso se compara por dniHash. */
async function findUserByDni(db, value) {
  const dni = normalizeDni(value)
  if (!dni) return null
  const dniHash = hashDni(dni)
  const direct = await db.collection('users').findOne({ dniHash })
  if (direct) return direct
  // Compatibilidad con registros viejos: DNI cifrado sin dniHash.
  const users = await db.collection('users').find({}).toArray()
  for (const user of users) {
    if (normalizeDni(decrypt(user.dni)) !== dni) continue
    try { await db.collection('users').updateOne({ id: user.id }, { $set: { dniHash } }) } catch {}
    return { ...user, dniHash }
  }
  return null
}

/**
 * Devuelve el paciente asociado al DNI o crea un registro "sin cuenta".
 * Estos registros se generan con las solicitudes de WhatsApp y luego el
 * paciente los reclama al crear su cuenta con el mismo DNI.
 */
async function findOrCreatePatientByDni(db, { dni, name, phone, email, origin = 'whatsapp' } = {}) {
  const normalized = normalizeDni(dni)
  if (!normalized) return null
  const dniHash = hashDni(normalized)
  let patient = await findUserByDni(db, normalized)
  if (patient) {
    const update = {}
    if (name && !patient.name) update.name = name.trim()
    if (phone && !decrypt(patient.phone)) update.phone = encrypt(phone)
    if (email && !patient.email) update.email = String(email).toLowerCase().trim()
    if (!patient.dniHash) update.dniHash = dniHash
    if (Object.keys(update).length) {
      try { await db.collection('users').updateOne({ id: patient.id }, { $set: update }) } catch {}
      patient = { ...patient, ...update }
    }
    return patient
  }

  patient = {
    id: uuidv4(),
    name: (name || '').trim() || `Paciente DNI ${normalized}`,
    role: 'patient',
    password: null,
    hasAccount: false,
    createdFrom: origin,
    dni: encrypt(normalized),
    dniHash,
    phone: encrypt(phone || ''),
    twoFactorEnabled: false,
    failedLoginCount: 0,
    createdAt: new Date(),
  }
  if (email) patient.email = String(email).toLowerCase().trim()
  try {
    await db.collection('users').insertOne(patient)
    return patient
  } catch (e) {
    if (e.code === 11000 || e.code === '23505') return await findUserByDni(db, normalized)
    throw e
  }
}

async function audit(db, req, { userId = null, action, entity, entityId = null, oldValues = null, newValues = null }) {
  await db.collection('audit_logs').insertOne({
    id: uuidv4(),
    userId, action, entity, entityId, oldValues, newValues,
    ipAddress: req ? clientIp(req) : null,
    userAgent: req ? (req.headers.get('user-agent') || null) : null,
    at: new Date(),
  })
}

async function currentUser(req) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace('Bearer ', '').trim()
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload?.uid) return null
  const db = await getDb()
  const user = await db.collection('users').findOne({ id: payload.uid })
  if (!user || user.lockedUntil && new Date(user.lockedUntil) > new Date()) return null
  const { password, twoFactorSecret, recoveryCodes, ...safe } = user
  safe.twoFactorEnabled = !!user.twoFactorEnabled
  safe.stepUpVerified = !!payload.mfa
  return safe
}

function requireRole(user, roles) {
  if (!user) return err('No autenticado', 401)
  if (roles && !roles.includes(user.role)) return err('Sin permisos suficientes', 403)
  return null
}

/** Admin check for destructive endpoints: valid admin session OR SEED_SECRET header */
async function isAdminRequest(req) {
  const secretHeader = req.headers.get('x-seed-secret')
  if (SEED_SECRET && secretHeader === SEED_SECRET) return true
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim()
  const payload = verifyToken(token)
  if (!payload?.uid) return false
  const db = await getDb()
  const u = await db.collection('users').findOne({ id: payload.uid })
  return !!u && u.role === 'admin' && !(u.lockedUntil && new Date(u.lockedUntil) > new Date())
}

function timeToMinutes(t) { const [h,m] = t.split(':').map(Number); return h*60+m }
function minutesToTime(m) { const h=Math.floor(m/60), mm=m%60; return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}` }

/* ================= Zod schemas ================= */
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM')
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD')

const LoginSchema = z.object({
  email: z.string().email('Email inválido').optional(),
  dni: z.string().trim().min(6, 'DNI inválido').max(20, 'DNI inválido').optional(),
  password: z.string().min(1, 'Contraseña requerida'),
  totp: z.string().optional(),
}).refine(data => data.email || data.dni, {
  message: 'Ingrese su DNI o email',
  path: ['dni'],
})
const RegisterSchema = z.object({
  name: z.string().min(3, 'Nombre requerido'),
  dni: z.string().trim().min(6, 'DNI inválido').max(20, 'DNI inválido')
    .refine(value => normalizeDni(value).length >= 6, 'DNI inválido'),
  email: z.string().trim().email('Email inválido').optional().or(z.literal('')),
  password: z.string().min(1, 'Contraseña requerida'),
  phone: z.string().optional(),
  captchaToken: z.string().optional(),
})
const AppointmentSchema = z.object({
  patientId: z.string().nullable().optional(),
  patientName: z.string().min(2).optional(),
  patientEmail: z.string().email().optional().or(z.literal('')),
  patientDni: z.string().trim().min(6, 'DNI inválido').max(20).optional(),
  patientPhone: z.string().optional(),
  doctorId: z.string().min(1),
  specialtyId: z.string().min(1).optional(),
  branchId: z.string().min(1),
  officeId: z.string().optional(),
  date: dateStr,
  startTime: timeStr,
  endTime: timeStr,
  notes: z.string().optional(),
  captchaToken: z.string().optional(),
})
const UpdateAppointmentSchema = z.object({
  status: z.enum(['pending','confirmed','in_room','attended','cancelled','no_show']).optional(),
  cancelReason: z.string().optional(),
  date: dateStr.optional(),
  startTime: timeStr.optional(),
  endTime: timeStr.optional(),
  notes: z.string().optional(),
})
const WhatsAppRequestSchema = z.object({
  name: z.string().trim().min(2, 'Nombre requerido').max(80, 'Nombre demasiado largo'),
  dni: z.string().trim().min(4, 'DNI requerido').max(30, 'DNI demasiado largo')
    .refine(value => normalizeDni(value).length >= 6, 'DNI inválido'),
  phone: z.string().trim().max(30).optional().default(''),
  specialtyId: z.string().max(80).optional().default(''),
  branchId: z.string().max(80).optional().default(''),
  preferred: z.string().trim().max(120, 'Preferencia demasiado larga').optional().default(''),
  message: z.string().trim().max(600, 'Consulta demasiado larga').optional().default(''),
  website: z.string().max(200).optional().default(''),
})
const ClinicalRecordSchema = z.object({
  patientId: z.string().min(1, 'Paciente requerido'),
  appointmentId: z.string().optional(),
  date: dateStr.optional(),
  reason: z.string().trim().max(200).optional().default(''),
  diagnosis: z.string().trim().max(2000).optional().default(''),
  treatment: z.string().trim().max(2000).optional().default(''),
  notes: z.string().trim().max(4000).optional().default(''),
})

/* ================= SEED ================= */
async function handleSeed(req) {
  const db = await getDb()
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'

  // Detect legacy plain-text passwords and auto-reseed
  const anyUser = await db.collection('users').findOne({})
  const legacy = anyUser && typeof anyUser.password === 'string' && !anyUser.password.startsWith('$2')
  const specCount = await db.collection('specialties').countDocuments()

  if (specCount > 0 && !force && !legacy) return ok({ ok: true, alreadySeeded: true })

  // Proteger el wipe: solo administrador o SEED_SECRET pueden regenerar datos existentes.
  // Si la BD está completamente vacía, el seed inicial es público (bootstrap).
  if (anyUser || specCount > 0) {
    if (!(await isAdminRequest(req))) {
      return err('Seed restringido: requiere sesión de administrador o header X-Seed-Secret', 403)
    }
  }

  // wipe
  for (const c of ['users','specialties','branches','offices','doctors','schedules','appointments','whatsapp_requests','clinical_records','audit_logs']) {
    await db.collection(c).deleteMany({})
  }

  const specialties = [
    { name: 'Clínica Médica', description: 'Consulta médica general', icon: 'Stethoscope' },
    { name: 'Cardiología', description: 'Salud cardiovascular y estudios especializados', icon: 'HeartPulse' },
    { name: 'Pediatría', description: 'Atención integral para niños y adolescentes', icon: 'Baby' },
    { name: 'Dermatología', description: 'Cuidado y estética de la piel', icon: 'Sparkles' },
    { name: 'Traumatología', description: 'Sistema musculoesquelético y lesiones', icon: 'Bone' },
    { name: 'Ginecología', description: 'Salud integral de la mujer', icon: 'Flower2' },
    { name: 'Oftalmología', description: 'Salud visual y cirugía ocular', icon: 'Eye' },
    { name: 'Nutrición', description: 'Planes alimenticios personalizados', icon: 'Brain' },
  ].map(s => ({ id: uuidv4(), ...s, defaultDurationMin: 30 }))

  const branches = [
    { id: uuidv4(), name: 'Sede Centro', address: 'Av. Corrientes 1500', city: 'Buenos Aires', phone: '+54 11 4800-1000' },
    { id: uuidv4(), name: 'Sede Norte',  address: 'Av. Libertador 3800', city: 'Buenos Aires', phone: '+54 11 4800-2000' },
    { id: uuidv4(), name: 'Sede Sur',    address: 'Av. Mitre 900',       city: 'Avellaneda',   phone: '+54 11 4800-3000' },
  ]
  const offices = []
  for (const b of branches) for (let i=1;i<=4;i++) offices.push({ id: uuidv4(), branchId: b.id, name: `Consultorio ${i}`, floor: i<=2?'PB':'1° piso' })

  const drNames = [
    ['Valentina','Rossi','Cardiología'],['Mateo','Fernández','Cardiología'],
    ['Sofía','Álvarez','Dermatología'],['Julián','Méndez','Pediatría'],
    ['Camila','Torres','Ginecología'],['Bruno','Lombardi','Traumatología'],
    ['Lucía','Herrera','Oftalmología'],['Nicolás','Ibarra','Nutrición'],
    ['Isabella','Costa','Clínica Médica'],['Rodrigo','Paz','Clínica Médica'],
    ['Delfina','Ramos','Pediatría'],['Emilio','Vega','Dermatología'],
  ]
  const doctors = [], doctorUsers = []
  const drPwdHash = await hashPassword('Doctor@2025!')
  for (const [fn, ln, sp] of drNames) {
    const specialty = specialties.find(s => s.name === sp)
    const doctorId = uuidv4(), userId = uuidv4()
    doctorUsers.push({
      id: userId, email: `dr.${ln.toLowerCase().replace(/[^a-z]/g,'')}@clinicabuenasalud.com`,
      password: drPwdHash, name: `Dr/a. ${fn} ${ln}`, role: 'doctor', doctorId,
      phone: encrypt('+54 11 5000-0000'),
      twoFactorEnabled: false, failedLoginCount: 0, createdAt: new Date(),
    })
    doctors.push({
      id: doctorId, userId, firstName: fn, lastName: ln, licenseNumber: `MP-${10000 + Math.floor(Math.random()*90000)}`,
      specialtyIds: [specialty.id],
      branchIds: branches.slice(0, 2 + Math.floor(Math.random()*2)).map(b => b.id),
      bio: `Especialista en ${sp} con vasta experiencia clínica.`,
      fee: 15000 + Math.floor(Math.random()*10)*1000, createdAt: new Date(),
    })
  }

  // schedules Mon-Fri 08:00-20:00, Sat 08:00-13:00
  const schedules = []
  for (const d of doctors) for (const branchId of d.branchIds) {
    for (let dow=1; dow<=5; dow++) schedules.push({ id: uuidv4(), doctorId: d.id, branchId, dayOfWeek: dow, startTime: '08:00', endTime: '20:00', slotMinutes: 30 })
    schedules.push({ id: uuidv4(), doctorId: d.id, branchId, dayOfWeek: 6, startTime: '08:00', endTime: '13:00', slotMinutes: 30 })
  }

  // 20 patients
  const patients = []
  const pwdPatient = await hashPassword('Paciente@2025!')
  const nombres = ['María','Juan','Sofía','Diego','Camila','Nicolás','Valentina','Martín','Julieta','Federico','Lucía','Pablo','Agustina','Tomás','Florencia','Gonzalo','Micaela','Ezequiel','Belén','Ignacio']
  const apellidos = ['González','Pérez','Rodríguez','López','Martínez','García','Sánchez','Romero','Sosa','Torres','Álvarez','Ruiz','Ramírez','Flores','Acosta','Molina','Silva','Núñez','Herrera','Medina']
  for (let i=0;i<20;i++) {
    const dni = `3${5000000+i*13}`
    patients.push({
      id: uuidv4(),
      email: `paciente${i+1}@ejemplo.com`,
      password: pwdPatient,
      name: `${nombres[i]} ${apellidos[i]}`,
      role: 'patient',
      phone: encrypt(`+54 11 6${100+i}-${1000+i}`),
      dni: encrypt(dni),
      dniHash: hashDni(dni),
      address: encrypt(`Calle Falsa ${100+i}`),
      birthDate: `19${70+(i%30)}-0${(i%9)+1}-1${(i%9)}`,
      twoFactorEnabled: false, failedLoginCount: 0, createdAt: new Date(),
    })
  }

  const adminUser = { id: uuidv4(), email: 'admin@clinicabuenasalud.com', password: await hashPassword('Admin@2025!'),
    name: 'Administración', role: 'admin', phone: encrypt('+54 11 4800-0000'), twoFactorEnabled: false, failedLoginCount: 0, createdAt: new Date() }
  const receptionDni = '30111222'
  const receptionUser = { id: uuidv4(), email: 'recepcion@clinicabuenasalud.com', password: await hashPassword('Recepcion@2025!'),
    name: 'Recepción Central', role: 'reception', phone: encrypt('+54 11 4800-0001'),
    dni: encrypt(receptionDni), dniHash: hashDni(receptionDni),
    twoFactorEnabled: false, failedLoginCount: 0, createdAt: new Date() }
  // Keep legacy demo patient
  const demoDni = '35678910'
  const demoPatient = { id: uuidv4(), email: 'paciente@ejemplo.com', password: await hashPassword('Paciente@2025!'),
    name: 'María González Demo', role: 'patient', phone: encrypt('+54 11 6100-1234'),
    dni: encrypt(demoDni), dniHash: hashDni(demoDni),
    birthDate: '1988-05-14', twoFactorEnabled: false, failedLoginCount: 0, createdAt: new Date() }

  await db.collection('specialties').insertMany(specialties)
  await db.collection('branches').insertMany(branches)
  await db.collection('offices').insertMany(offices)
  await db.collection('doctors').insertMany(doctors)
  await db.collection('schedules').insertMany(schedules)
  await db.collection('users').insertMany([adminUser, receptionUser, demoPatient, ...patients, ...doctorUsers])

  // indexes for anti-overlap + audit performance
  await db.collection('appointments').createIndex({ doctorId: 1, date: 1, startTime: 1 }, { unique: true })
  await db.collection('appointments').createIndex({ patientId: 1, date: 1 })
  await db.collection('audit_logs').createIndex({ at: -1 })
  await db.collection('users').createIndex({ email: 1 }, { unique: true })

  // 30 sample appointments in varied statuses
  const statuses = ['pending','confirmed','in_room','attended','cancelled','no_show']
  const sample = []; const used = new Set()
  const today = new Date()
  const allPatients = [demoPatient, ...patients]
  for (let i = 0; i < 30; i++) {
    for (let tries=0; tries<10; tries++) {
      const doctor = doctors[Math.floor(Math.random()*doctors.length)]
      const branchId = doctor.branchIds[Math.floor(Math.random()*doctor.branchIds.length)]
      const dayOffset = Math.floor(Math.random()*10) - 3 // -3..+6
      const d = new Date(today); d.setDate(d.getDate()+dayOffset)
      if (d.getDay()===0) continue
      const hour = 8 + Math.floor(Math.random()*10)
      const minute = Math.random()>0.5 ? '30' : '00'
      const dateStr = d.toISOString().slice(0,10)
      const startTime = `${String(hour).padStart(2,'0')}:${minute}`
      const k = `${doctor.id}-${dateStr}-${startTime}`
      if (used.has(k)) continue
      used.add(k)
      const p = allPatients[Math.floor(Math.random()*allPatients.length)]
      const office = offices.find(o => o.branchId===branchId)
      const status = dayOffset < 0 ? (Math.random()>0.3?'attended':(Math.random()>0.5?'no_show':'cancelled')) : statuses[Math.floor(Math.random()*3)]
      sample.push({
        id: uuidv4(),
        patientId: p.id, patientName: p.name, patientPhone: p.phone, patientDni: p.dni, patientEmail: p.email,
        doctorId: doctor.id, doctorName: `Dr/a. ${doctor.firstName} ${doctor.lastName}`,
        specialtyId: doctor.specialtyIds[0], specialtyName: specialties.find(s=>s.id===doctor.specialtyIds[0]).name,
        branchId, branchName: branches.find(b=>b.id===branchId).name,
        officeId: office.id, officeName: office.name,
        date: dateStr, startTime, endTime: minutesToTime(timeToMinutes(startTime)+30),
        status, notes: '', createdAt: new Date(),
      })
      break
    }
  }
  if (sample.length) await db.collection('appointments').insertMany(sample)

  await audit(db, req, { action: 'SEED', entity: 'system', newValues: { seededAt: new Date() } })
  return ok({ ok: true, seeded: true, counts: {
    specialties: specialties.length, branches: branches.length, offices: offices.length,
    doctors: doctors.length, patients: patients.length + 1, users: 3 + patients.length + doctorUsers.length,
    appointments: sample.length,
  }, credentials: {
    admin: 'admin@clinicabuenasalud.com / Admin@2025!',
    reception: 'DNI 30111222 / Recepcion@2025!',
    doctor: 'dr.rossi@clinicabuenasalud.com / Doctor@2025!',
    patient: 'DNI 35678910 / Paciente@2025!',
  }})
}

/* ================= AUTH ================= */
async function handleLogin(req) {
  const ip = clientIp(req)
  const rl = rateLimit(`login:${ip}`, 5, 60_000)
  if (!rl.allowed) return err('Demasiados intentos. Espere un minuto.', 429)
  let body
  try { body = LoginSchema.parse(await req.json()) } catch (e) { return badZod(e) }
  const { email, password, totp } = body
  const db = await getDb()
  const user = body.dni
    ? await findUserByDni(db, body.dni)
    : await db.collection('users').findOne({ email: String(email).toLowerCase().trim() })
  if (!user) {
    await audit(db, req, { action: 'LOGIN_FAIL', entity: 'auth', newValues: { method: body.dni ? 'dni' : 'email' } })
    return err('Credenciales inválidas', 401)
  }
  // Pacientes y recepción se identifican por DNI. El email queda solo para
  // admin/médicos, que además tienen 2FA obligatorio.
  if (!body.dni && ['patient', 'reception'].includes(user.role)) {
    await audit(db, req, { action: 'LOGIN_FAIL', entity: 'auth', newValues: { method: 'email', reason: 'role_requires_dni' } })
    return err('Pacientes y recepción deben ingresar con su DNI', 400)
  }
  if (!user.password) {
    return err('Este DNI ya tiene una solicitud registrada. Creá tu cuenta con el mismo DNI para ingresar y ver tu historial.', 403, { needsRegistration: true })
  }
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return err('Cuenta bloqueada temporalmente. Intente más tarde.', 423)
  }
  const okPwd = await verifyPassword(password, user.password)
  if (!okPwd) {
    const fails = (user.failedLoginCount || 0) + 1
    const update = { failedLoginCount: fails }
    if (fails >= 5) update.lockedUntil = new Date(Date.now() + 15 * 60_000)
    await db.collection('users').updateOne({ id: user.id }, { $set: update })
    await audit(db, req, { userId: user.id, action: 'LOGIN_FAIL', entity: 'auth', newValues: { fails } })
    return err('Credenciales inválidas', 401)
  }
  // 2FA gate
  const mustHave2FA = SENSITIVE_ROLES_2FA.includes(user.role)
  if (user.twoFactorEnabled) {
    if (!totp) return ok({ require2FA: true, setup: false })
    if (!verifyTotp(totp, user.twoFactorSecret)) {
      await audit(db, req, { userId: user.id, action: 'LOGIN_2FA_FAIL', entity: 'auth' })
      return err('Código 2FA inválido', 401)
    }
  } else if (mustHave2FA) {
    // requires setup: issue short-lived setup token
    const setupToken = signToken({ uid: user.id, purpose: 'setup2fa' }, 60 * 15)
    return ok({ require2FA: true, setup: true, setupToken })
  }
  await db.collection('users').updateOne({ id: user.id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } })
  const token = signToken({ uid: user.id, role: user.role, mfa: !!user.twoFactorEnabled })
  const { password: _p, twoFactorSecret, recoveryCodes, ...safe } = user
  safe.twoFactorEnabled = !!user.twoFactorEnabled
  await audit(db, req, { userId: user.id, action: 'LOGIN', entity: 'auth' })
  return ok({ token, user: decryptFields(safe, SENSITIVE_USER) })
}

async function handleRegister(req) {
  const ip = clientIp(req)
  const rl = rateLimit(`register:${ip}`, 5, 60_000)
  if (!rl.allowed) return err('Demasiados registros. Espere un minuto.', 429)
  let body
  try { body = RegisterSchema.parse(await req.json()) } catch (e) { return badZod(e) }
  if (!(await verifyCaptcha(body.captchaToken))) return err('Verificación CAPTCHA inválida', 403)
  if (!passwordStrong(body.password)) {
    return err('La contraseña debe tener al menos 10 caracteres, una mayúscula, un número y un símbolo', 400)
  }
  const db = await getDb()
  const dni = normalizeDni(body.dni)
  const email = body.email ? body.email.toLowerCase().trim() : ''

  // El DNI es la clave única del paciente. Si ya existe un registro sin cuenta
  // (por ejemplo, creado desde una solicitud de WhatsApp), se "reclama" y
  // conserva todo el historial de turnos.
  const existing = await findUserByDni(db, dni)
  if (existing?.password) return err('Ya existe una cuenta con ese DNI', 409)

  if (email) {
    const emailOwner = await db.collection('users').findOne({ email })
    if (emailOwner && emailOwner.id !== existing?.id) return err('Ya existe una cuenta con ese email', 409)
  }

  const password = await hashPassword(body.password)
  const phone = body.phone ? encrypt(body.phone) : (existing?.phone || encrypt(''))
  let user

  if (existing) {
    const update = {
      name: body.name.trim(),
      password,
      phone,
      dni: existing.dni || encrypt(dni),
      dniHash: hashDni(dni),
      hasAccount: true,
      twoFactorEnabled: !!existing.twoFactorEnabled,
      failedLoginCount: 0,
      lockedUntil: null,
      registeredAt: new Date(),
    }
    if (email && !existing.email) update.email = email
    await db.collection('users').updateOne({ id: existing.id }, { $set: update })
    user = { ...existing, ...update }
  } else {
    user = {
      id: uuidv4(),
      name: body.name.trim(),
      password,
      role: 'patient',
      phone,
      dni: encrypt(dni),
      dniHash: hashDni(dni),
      hasAccount: true,
      createdFrom: 'web',
      twoFactorEnabled: false,
      failedLoginCount: 0,
      createdAt: new Date(),
    }
    if (email) user.email = email
    await db.collection('users').insertOne(user)
  }

  await audit(db, req, {
    userId: user.id,
    action: existing ? 'CLAIM_PATIENT_ACCOUNT' : 'REGISTER',
    entity: 'auth',
    newValues: { method: 'dni', claimedHistory: !!existing },
  })
  const token = signToken({ uid: user.id, role: user.role, mfa: false })
  const { password: _p, twoFactorSecret, recoveryCodes, pending2FASecret, ...safe } = user
  safe.twoFactorEnabled = !!user.twoFactorEnabled
  return ok({ token, user: decryptFields(safe, SENSITIVE_USER), claimedHistory: !!existing }, 201)
}

async function handle2FASetup(req) {
  // Uses setup token from login OR authenticated user
  const auth = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  const payload = verifyToken(auth)
  if (!payload?.uid) return err('No autorizado', 401)
  const db = await getDb()
  const user = await db.collection('users').findOne({ id: payload.uid })
  if (!user) return err('Usuario no encontrado', 404)
  const secret = generateTotpSecret()
  const uri = totpUri(secret, user.email || user.name || 'paciente')
  const qr = await QRCode.toDataURL(uri)
  await db.collection('users').updateOne({ id: user.id }, { $set: { pending2FASecret: secret } })
  return ok({ secret, uri, qr })
}

async function handle2FAVerify(req) {
  const auth = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  const payload = verifyToken(auth)
  if (!payload?.uid) return err('No autorizado', 401)
  const body = await req.json()
  const totp = String(body?.totp || '').trim()
  const db = await getDb()
  const user = await db.collection('users').findOne({ id: payload.uid })
  const secret = user?.pending2FASecret
  if (!secret) return err('No hay 2FA pendiente', 400)
  if (!verifyTotp(totp, secret)) return err('Código inválido', 401)
  const recovery = generateRecoveryCodes(10)
  const recoveryHashes = await Promise.all(recovery.map(c => hashPassword(c)))
  await db.collection('users').updateOne({ id: user.id }, {
    $set: { twoFactorEnabled: true, twoFactorSecret: secret, recoveryCodes: recoveryHashes },
    $unset: { pending2FASecret: '' },
  })
  await audit(db, req, { userId: user.id, action: '2FA_ENABLED', entity: 'auth' })
  const token = signToken({ uid: user.id, role: user.role, mfa: true })
  const { password, twoFactorSecret, recoveryCodes, pending2FASecret, ...safe } = user
  safe.twoFactorEnabled = true
  return ok({ token, user: decryptFields(safe, SENSITIVE_USER), recoveryCodes: recovery })
}

async function handleMe(req) {
  const u = await currentUser(req); if (!u) return err('No autenticado', 401)
  return ok({ user: decryptFields(u, SENSITIVE_USER) })
}

async function handleLogout(req) {
  const u = await currentUser(req)
  if (u) await audit(await getDb(), req, { userId: u.id, action: 'LOGOUT', entity: 'auth' })
  return ok({ ok: true })
}

/* ================= LOOKUPS ================= */
async function handleList(collection, decryptUsers = false) {
  const db = await getDb()
  const list = await db.collection(collection).find({}).toArray()
  const clean = list.map(({ _id, password, twoFactorSecret, recoveryCodes, pending2FASecret, ...r }) => decryptUsers ? decryptFields(r, SENSITIVE_USER) : r)
  return ok({ [collection]: clean })
}

/* ================= AVAILABILITY ================= */
async function handleAvailability(req, { doctorId }) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const branchId = searchParams.get('branchId')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('date requerido (YYYY-MM-DD)', 400)
  const db = await getDb()
  const d = new Date(date + 'T00:00:00'); const dow = d.getDay()
  const q = { doctorId, dayOfWeek: dow }; if (branchId) q.branchId = branchId
  const schedules = await db.collection('schedules').find(q).toArray()
  const booked = await db.collection('appointments').find({ doctorId, date, status: { $nin: ['cancelled','no_show'] } }).toArray()
  const bookedRanges = booked.map(b => ({ start: timeToMinutes(b.startTime), end: timeToMinutes(b.endTime) }))
  const nowMsUtc = nowMs()
  const slots = []
  for (const s of schedules) {
    for (let m = timeToMinutes(s.startTime); m + s.slotMinutes <= timeToMinutes(s.endTime); m += s.slotMinutes) {
      const startMs = argentinaLocalToUtcMs(date, minutesToTime(m))
      const tooSoon = startMs - nowMsUtc < APPT_MIN_HOURS_AHEAD * 3600 * 1000
      const isBooked = bookedRanges.some(r => !(m + s.slotMinutes <= r.start || m >= r.end))
      slots.push({ startTime: minutesToTime(m), endTime: minutesToTime(m + s.slotMinutes), branchId: s.branchId, available: !isBooked && !tooSoon })
    }
  }
  slots.sort((a,b) => a.startTime.localeCompare(b.startTime))
  return ok({ date, doctorId, slots })
}

/* ================= APPOINTMENTS ================= */
async function handleCreateAppointment(req) {
  const user = await currentUser(req)
  if (!user) return err('Debe iniciar sesión o crear una cuenta para solicitar un turno', 401)
  const ip = clientIp(req)
  const rl = rateLimit(`appt:${user.id || ip}`, 10, 60_000)
  if (!rl.allowed) return err('Demasiadas reservas. Espere un minuto.', 429)
  let body
  try { body = AppointmentSchema.parse(await req.json()) } catch (e) { return badZod(e) }
  if (!(await verifyCaptcha(body.captchaToken))) return err('Verificación CAPTCHA inválida', 403)

  const db = await getDb()

  // Un paciente solo puede reservar turnos a su propio nombre (evita suplantación)
  if (user.role === 'patient') {
    body.patientId = user.id
    body.patientEmail = user.email || ''
    body.patientName = user.name
    const ownDni = normalizeDni(decrypt(user.dni))
    if (ownDni) {
      body.patientDni = ownDni
    } else if (body.patientDni) {
      // Completa el DNI de una cuenta vieja creada solo con email.
      const owner = await findUserByDni(db, body.patientDni)
      if (owner && owner.id !== user.id) return err('Ese DNI ya está asociado a otra cuenta', 409)
      await db.collection('users').updateOne({ id: user.id }, { $set: {
        dni: encrypt(normalizeDni(body.patientDni)), dniHash: hashDni(body.patientDni),
      } })
    } else {
      return err('Necesitamos tu DNI para asociar el turno a tu historial clínico', 400)
    }
  }

  const nowMsUtc = nowMs()
  const startMs = argentinaLocalToUtcMs(body.date, body.startTime)
  if (isNaN(startMs) || startMs - nowMsUtc < APPT_MIN_HOURS_AHEAD * 3600 * 1000) {
    return err('Los turnos requieren al menos 2 horas de anticipación', 400)
  }

  const startM = timeToMinutes(body.startTime), endM = timeToMinutes(body.endTime)
  if (endM <= startM) return err('Horario inválido', 400)
  const existing = await db.collection('appointments').find({ doctorId: body.doctorId, date: body.date, status: { $nin: ['cancelled','no_show'] } }).toArray()
  for (const a of existing) {
    const s = timeToMinutes(a.startTime), e = timeToMinutes(a.endTime)
    if (!(endM <= s || startM >= e)) return err('El horario elegido ya no está disponible.', 409)
  }
  const doctor = await db.collection('doctors').findOne({ id: body.doctorId })
  if (!doctor) return err('Médico no encontrado', 404)
  const specialty = body.specialtyId
    ? await db.collection('specialties').findOne({ id: body.specialtyId })
    : await db.collection('specialties').findOne({ id: doctor?.specialtyIds?.[0] })
  const branch = await db.collection('branches').findOne({ id: body.branchId })
  let office = body.officeId ? await db.collection('offices').findOne({ id: body.officeId }) : null
  if (!office) office = await db.collection('offices').findOne({ branchId: body.branchId })

  // Resolución del paciente: DNI como identidad principal.
  let patient = null
  if (body.patientId) patient = await db.collection('users').findOne({ id: body.patientId })
  if (!patient && body.patientDni) {
    patient = await findOrCreatePatientByDni(db, {
      dni: body.patientDni,
      name: body.patientName,
      phone: body.patientPhone,
      email: body.patientEmail || '',
      origin: user.role === 'patient' ? 'web' : 'reception',
    })
  }
  if (!patient && body.patientEmail) {
    patient = await db.collection('users').findOne({ email: body.patientEmail.toLowerCase() })
    if (!patient) {
      patient = {
        id: uuidv4(), email: body.patientEmail.toLowerCase(),
        password: null, hasAccount: false, createdFrom: 'appointment',
        name: body.patientName || body.patientEmail,
        role: 'patient', phone: encrypt(body.patientPhone || ''),
        twoFactorEnabled: false, failedLoginCount: 0, createdAt: new Date(),
      }
      try { await db.collection('users').insertOne(patient) } catch { patient = await db.collection('users').findOne({ email: patient.email }) }
    }
  }

  const patientDni = normalizeDni(body.patientDni || decrypt(patient?.dni))

  const doc = {
    id: uuidv4(),
    patientId: patient?.id || body.patientId || null,
    patientName: patient?.name || body.patientName || 'Invitado',
    patientPhone: encrypt(body.patientPhone || (patient?.phone ? decrypt(patient.phone) : '')),
    patientDni: patientDni ? encrypt(patientDni) : '',
    patientEmail: patient?.email || body.patientEmail || '',
    doctorId: body.doctorId,
    doctorName: doctor ? `Dr/a. ${doctor.firstName} ${doctor.lastName}` : '',
    specialtyId: specialty?.id || null, specialtyName: specialty?.name || '',
    branchId: body.branchId, branchName: branch?.name || '',
    officeId: office?.id || null, officeName: office?.name || '',
    date: body.date, startTime: body.startTime, endTime: body.endTime,
    status: 'pending', notes: encrypt(body.notes || ''),
    createdAt: new Date(),
  }
  try {
    await db.collection('appointments').insertOne(doc)
  } catch (e) {
    if (e.code === 11000) return err('El horario elegido ya no está disponible.', 409)
    throw e
  }
  await audit(db, req, { userId: doc.patientId, action: 'CREATE_APPOINTMENT', entity: 'appointment', entityId: doc.id, newValues: { doctorId: body.doctorId, date: body.date, startTime: body.startTime } })
  return ok({ appointment: decryptFields(doc, SENSITIVE_APPT) })
}

async function handleListAppointments(req) {
  const user = await currentUser(req)
  const gate = requireRole(user, ['admin', 'reception', 'doctor', 'patient'])
  if (gate) return gate
  const { searchParams } = new URL(req.url)
  const q = {}
  for (const k of ['doctorId','patientId','branchId','specialtyId','status']) {
    const v = searchParams.get(k); if (v) q[k] = v
  }
  const from = searchParams.get('from'), to = searchParams.get('to')
  if (from || to) { q.date = {}; if (from) q.date.$gte = from; if (to) q.date.$lte = to }
  // Scoping por rol: cada uno solo ve lo que le corresponde
  if (user.role === 'patient') q.patientId = user.id
  else if (user.role === 'doctor') q.doctorId = user.doctorId
  const db = await getDb()
  const list = await db.collection('appointments').find(q).sort({ date: 1, startTime: 1 }).toArray()
  return ok({ appointments: list.map(({ _id, ...r }) => decryptFields(r, SENSITIVE_APPT)) })
}

async function handleUpdateAppointment(req, { id }) {
  const user = await currentUser(req)
  const gate = requireRole(user, ['admin', 'reception', 'doctor', 'patient'])
  if (gate) return gate
  let body
  try { body = UpdateAppointmentSchema.parse(await req.json()) } catch (e) { return badZod(e) }
  const db = await getDb()
  const appt = await db.collection('appointments').findOne({ id })
  if (!appt) return err('Turno no encontrado', 404)

  // Autorización sobre el turno concreto
  const isStaff = ['admin', 'reception'].includes(user.role)
  const isOwnPatient = user.role === 'patient' && appt.patientId === user.id
  const isOwnAgenda = user.role === 'doctor' && appt.doctorId === user.doctorId
  if (!isStaff && !isOwnPatient && !isOwnAgenda) return err('Sin permisos sobre este turno', 403)
  // Un paciente solo puede cancelar sus propios turnos (no reprogramar ni editar notas)
  if (isOwnPatient && !isStaff) {
    if (body.status && body.status !== 'cancelled') return err('Solo puede cancelar sus turnos', 403)
    if (body.date || body.startTime || body.endTime || body.notes !== undefined) {
      return err('Solo puede cancelar sus turnos', 403)
    }
  }

  const update = { updatedAt: new Date() }
  if (body.status) update.status = body.status
  if (body.cancelReason !== undefined) update.cancelReason = body.cancelReason
  if (body.notes !== undefined) update.notes = encrypt(body.notes)

  // late cancellation flag
  if (body.status === 'cancelled') {
    const startMs = argentinaLocalToUtcMs(appt.date, appt.startTime)
    if (startMs - nowMs() < 24 * 3600 * 1000) update.lateCancellation = true
  }

  if (body.date && body.startTime && body.endTime) {
    const startM = timeToMinutes(body.startTime), endM = timeToMinutes(body.endTime)
    if (endM <= startM) return err('Horario inválido', 400)
    const existing = await db.collection('appointments').find({ doctorId: appt.doctorId, date: body.date, id: { $ne: id }, status: { $nin: ['cancelled','no_show'] } }).toArray()
    for (const a of existing) {
      const s = timeToMinutes(a.startTime), e = timeToMinutes(a.endTime)
      if (!(endM <= s || startM >= e)) return err('El nuevo horario ya está ocupado', 409)
    }
    update.date = body.date; update.startTime = body.startTime; update.endTime = body.endTime
  }
  await db.collection('appointments').updateOne({ id }, { $set: update })
  await audit(db, req, { action: 'UPDATE_APPOINTMENT', entity: 'appointment', entityId: id, oldValues: { status: appt.status, date: appt.date, startTime: appt.startTime }, newValues: update })
  const fresh = await db.collection('appointments').findOne({ id })
  const { _id, ...safe } = fresh
  return ok({ appointment: decryptFields(safe, SENSITIVE_APPT) })
}

/* ================= SOLICITUDES WHATSAPP (centro de ayuda) ================= */
async function handleCreateWhatsAppRequest(req) {
  const ip = clientIp(req)
  const rl = rateLimit(`wa-request:${ip}`, 5, 10 * 60_000)
  if (!rl.allowed) return err('Demasiadas solicitudes. Esperá unos minutos.', 429)

  let body
  try { body = WhatsAppRequestSchema.parse(await req.json()) } catch (e) { return badZod(e) }
  if (body.website) return ok({ ok: true }) // honeypot: respondemos ok sin guardar nada

  const db = await getDb()
  const specialty = body.specialtyId
    ? await db.collection('specialties').findOne({ id: body.specialtyId })
    : null
  const branch = body.branchId
    ? await db.collection('branches').findOne({ id: body.branchId })
    : null

  // El DNI identifica al paciente: si ya existe se reutiliza su ficha e
  // historial; si no, se crea una ficha sin cuenta para que luego la reclame.
  const dni = normalizeDni(body.dni)
  const patient = await findOrCreatePatientByDni(db, {
    dni,
    name: body.name,
    phone: body.phone,
    origin: 'whatsapp',
  })

  const doc = {
    id: uuidv4(),
    patientId: patient?.id || null,
    name: patient?.name || body.name,
    patientName: patient?.name || body.name,
    patientHasAccount: !!patient?.password,
    dni: encrypt(dni),
    dniHash: hashDni(dni),
    phone: encrypt(body.phone || ''),
    specialtyId: specialty?.id || '',
    specialtyName: specialty?.name || '',
    branchId: branch?.id || '',
    branchName: branch?.name || '',
    preferred: encrypt(body.preferred || ''),
    message: encrypt(body.message || ''),
    status: 'new',
    source: 'web-widget',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await db.collection('whatsapp_requests').insertOne(doc)

  const message = buildAppointmentRequestMessage({
    name: body.name,
    dni: body.dni,
    phone: body.phone,
    specialtyName: doc.specialtyName,
    branchName: doc.branchName,
    preferred: body.preferred,
    message: body.message,
  })

  await audit(db, req, {
    action: 'CREATE_WHATSAPP_REQUEST',
    entity: 'whatsapp_request',
    entityId: doc.id,
    newValues: { specialtyId: doc.specialtyId, branchId: doc.branchId, status: doc.status },
  })

  return ok({
    request: { id: doc.id, status: doc.status, createdAt: doc.createdAt, patientId: doc.patientId },
    patient: {
      id: patient?.id || null,
      name: patient?.name || body.name,
      hasAccount: !!patient?.password,
    },
    waUrl: buildWaUrl(WHATSAPP_NUMBER, message),
    message,
  }, 201)
}

async function handleListWhatsAppRequests(req) {
  const u = await currentUser(req); const gate = requireRole(u, ['admin', 'reception']); if (gate) return gate
  const db = await getDb()
  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const filter = ['new', 'contacted', 'closed'].includes(status) ? { status } : {}
  const rows = await db.collection('whatsapp_requests').find(filter).sort({ createdAt: -1 }).limit(200).toArray()
  // El estado de la cuenta se calcula al leer: una solicitud creada antes del
  // registro debe dejar de mostrar "cuenta pendiente" apenas el paciente reclama su DNI.
  const patientIds = [...new Set(rows.map(r => r.patientId).filter(Boolean))]
  const patients = patientIds.length
    ? await db.collection('users').find({ id: { $in: patientIds } }).toArray()
    : []
  const patientById = new Map(patients.map(p => [p.id, p]))
  return ok({
    requests: rows.map(({ _id, ...r }) => {
      const patient = patientById.get(r.patientId)
      return decryptFields({
        ...r,
        patientName: patient?.name || r.patientName,
        patientHasAccount: patient ? !!patient.password : !!r.patientHasAccount,
      }, SENSITIVE_WA)
    }),
  })
}

async function handleUpdateWhatsAppRequest(req, { id }) {
  const u = await currentUser(req); const gate = requireRole(u, ['admin', 'reception']); if (gate) return gate
  let body
  try { body = await req.json() } catch { return err('Datos inválidos', 400) }
  const status = String(body?.status || '')
  if (!['new', 'contacted', 'closed'].includes(status)) return err('Estado inválido', 400)

  const db = await getDb()
  const existing = await db.collection('whatsapp_requests').findOne({ id })
  if (!existing) return err('Solicitud no encontrada', 404)

  await db.collection('whatsapp_requests').updateOne({ id }, { $set: {
    status,
    updatedAt: new Date(),
    handledBy: u.id,
    handledByName: u.name,
  } })
  return ok({ ok: true, status })
}

/* ================= HISTORIAL CLÍNICO ================= */
async function handleClinicalHistory(req) {
  const user = await currentUser(req)
  const gate = requireRole(user, ['admin', 'reception', 'doctor', 'patient'])
  if (gate) return gate

  const { searchParams } = new URL(req.url)
  let patientId = searchParams.get('patientId')
  if (user.role === 'patient') patientId = user.id
  if (!patientId) return err('patientId requerido', 400)

  const db = await getDb()
  const patient = await db.collection('users').findOne({ id: patientId })
  if (!patient || patient.role !== 'patient') return err('Paciente no encontrado', 404)

  // Un médico solo accede a pacientes de su propia agenda.
  if (user.role === 'doctor') {
    const related = await db.collection('appointments').findOne({ patientId, doctorId: user.doctorId })
    if (!related) return err('Sin permisos sobre este historial', 403)
  }

  const [appointments, records, requests] = await Promise.all([
    db.collection('appointments').find({ patientId }).sort({ date: -1, startTime: -1 }).toArray(),
    db.collection('clinical_records').find({ patientId }).sort({ createdAt: -1 }).toArray(),
    db.collection('whatsapp_requests').find({ patientId }).sort({ createdAt: -1 }).limit(20).toArray(),
  ])

  const safeAppointments = appointments.map(({ _id, ...a }) => decryptFields(a, SENSITIVE_APPT))
  const safeRecords = records.map(({ _id, ...r }) => decryptFields(r, SENSITIVE_RECORD))
  const safeRequests = requests.map(({ _id, ...r }) => decryptFields({
    ...r,
    patientName: patient.name,
    patientHasAccount: !!patient.password,
  }, SENSITIVE_WA))

  const today = new Date().toISOString().slice(0, 10)
  const attended = safeAppointments.filter(a => a.status === 'attended')
  const upcoming = safeAppointments.filter(a =>
    a.date >= today && !['cancelled', 'no_show', 'attended'].includes(a.status))

  const { password, twoFactorSecret, recoveryCodes, pending2FASecret, ...patientSafe } = patient
  return ok({
    patient: decryptFields(patientSafe, SENSITIVE_USER),
    appointments: safeAppointments,
    records: safeRecords,
    whatsappRequests: safeRequests,
    summary: {
      totalAppointments: safeAppointments.length,
      attended: attended.length,
      upcoming: upcoming.length,
      clinicalRecords: safeRecords.length,
      whatsappRequests: safeRequests.length,
      lastVisit: attended[0]?.date || null,
      hasAccount: !!password,
    },
  })
}

async function handleCreateClinicalRecord(req) {
  const user = await currentUser(req)
  const gate = requireRole(user, ['admin', 'doctor'])
  if (gate) return gate

  let body
  try { body = ClinicalRecordSchema.parse(await req.json()) } catch (e) { return badZod(e) }

  const db = await getDb()
  const patient = await db.collection('users').findOne({ id: body.patientId })
  if (!patient || patient.role !== 'patient') return err('Paciente no encontrado', 404)

  let appointment = null
  if (body.appointmentId) {
    appointment = await db.collection('appointments').findOne({ id: body.appointmentId })
    if (!appointment) return err('Turno no encontrado', 404)
    if (appointment.patientId !== body.patientId) return err('El turno no pertenece al paciente', 400)
    if (user.role === 'doctor' && appointment.doctorId !== user.doctorId) {
      return err('Sin permisos sobre este turno', 403)
    }
  }

  const record = {
    id: uuidv4(),
    patientId: body.patientId,
    patientName: patient.name,
    patientDniHash: patient.dniHash || null,
    appointmentId: body.appointmentId || null,
    doctorId: user.role === 'doctor' ? user.doctorId : (appointment?.doctorId || null),
    doctorName: user.role === 'doctor' ? user.name : (appointment?.doctorName || user.name),
    date: body.date || appointment?.date || new Date().toISOString().slice(0, 10),
    reason: encrypt(body.reason || ''),
    diagnosis: encrypt(body.diagnosis || ''),
    treatment: encrypt(body.treatment || ''),
    notes: encrypt(body.notes || ''),
    createdAt: new Date(),
    createdBy: user.id,
  }
  await db.collection('clinical_records').insertOne(record)
  await audit(db, req, {
    userId: user.id,
    action: 'CREATE_CLINICAL_RECORD',
    entity: 'clinical_record',
    entityId: record.id,
    newValues: { patientId: body.patientId, appointmentId: record.appointmentId },
  })
  return ok({ record: decryptFields(record, SENSITIVE_RECORD) }, 201)
}

/* ================= STATS ================= */
async function handleStats() {
  const db = await getDb()
  const today = new Date().toISOString().slice(0,10)
  const [totalToday, confirmedToday, cancelledToday, total, bySpecialty, byStatus] = await Promise.all([
    db.collection('appointments').countDocuments({ date: today }),
    db.collection('appointments').countDocuments({ date: today, status: 'confirmed' }),
    db.collection('appointments').countDocuments({ date: today, status: 'cancelled' }),
    db.collection('appointments').countDocuments({}),
    db.collection('appointments').aggregate([{ $group: { _id: '$specialtyName', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
    db.collection('appointments').aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
  ])
  return ok({
    totalToday, confirmedToday, cancelledToday, total,
    bySpecialty: bySpecialty.map(x => ({ name: x._id, count: x.count })),
    byStatus: byStatus.map(x => ({ status: x._id, count: x.count })),
  })
}

/* ================= AUDIT ================= */
async function handleAudit(req) {
  const u = await currentUser(req); const gate = requireRole(u, ['admin']); if (gate) return gate
  const db = await getDb()
  const logs = await db.collection('audit_logs').find({}).sort({ at: -1 }).limit(200).toArray()
  return ok({ logs: logs.map(({ _id, ...r }) => r) })
}

/* ================= ROUTER ================= */
async function router(req, ctx) {
  const { params } = ctx
  const resolved = params && typeof params.then === 'function' ? await params : params
  const path = (resolved?.path || []).join('/')
  const method = req.method
  try {
    if (path === '' || path === 'health') return ok({ ok: true, service: 'clinica-buena-salud' })
    if (path === 'seed' && method === 'POST') return await handleSeed(req)

    if (path === 'auth/login' && method === 'POST') return await handleLogin(req)
    if (path === 'auth/register' && method === 'POST') return await handleRegister(req)
    if (path === 'auth/logout' && method === 'POST') return await handleLogout(req)
    if (path === 'auth/me' && method === 'GET') return await handleMe(req)
    if (path === 'auth/2fa/setup' && method === 'POST') return await handle2FASetup(req)
    if (path === 'auth/2fa/verify' && method === 'POST') return await handle2FAVerify(req)

    if (path === 'specialties' && method === 'GET') return await handleList('specialties')
    if (path === 'branches' && method === 'GET') return await handleList('branches')
    if (path === 'offices' && method === 'GET') return await handleList('offices')
    if (path === 'doctors' && method === 'GET') return await handleList('doctors')

    const availMatch = path.match(/^doctors\/([^/]+)\/availability$/)
    if (availMatch && method === 'GET') return await handleAvailability(req, { doctorId: availMatch[1] })

    if (path === 'appointments' && method === 'POST') return await handleCreateAppointment(req)
    if (path === 'appointments' && method === 'GET') return await handleListAppointments(req)
    const apptMatch = path.match(/^appointments\/([^/]+)$/)
    if (apptMatch && method === 'PATCH') return await handleUpdateAppointment(req, { id: apptMatch[1] })

    if (path === 'whatsapp-requests' && method === 'POST') return await handleCreateWhatsAppRequest(req)
    if (path === 'whatsapp-requests' && method === 'GET') return await handleListWhatsAppRequests(req)
    const waMatch = path.match(/^whatsapp-requests\/([^/]+)$/)
    if (waMatch && method === 'PATCH') return await handleUpdateWhatsAppRequest(req, { id: waMatch[1] })

    if (path === 'clinical-history' && method === 'GET') return await handleClinicalHistory(req)
    if (path === 'clinical-records' && method === 'POST') return await handleCreateClinicalRecord(req)

    if (path === 'stats' && method === 'GET') return await handleStats()
    if (path === 'audit' && method === 'GET') return await handleAudit(req)

    return err('Ruta no encontrada: ' + path, 404)
  } catch (e) {
    console.error('API error [ref]', e.name, e.message)
    return err('Error interno', 500)
  }
}

export const GET = router
export const POST = router
export const PATCH = router
export const PUT = router
export const DELETE = router
