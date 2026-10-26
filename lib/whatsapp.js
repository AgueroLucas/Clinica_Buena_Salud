// Utilidades compartidas por el widget publico, la bandeja de recepcion y la API.
// El numero se configura por variable de entorno; este valor es solo un fallback
// de demostracion para el proyecto de facultad.

export const DEFAULT_WHATSAPP_NUMBER = '542634368835'
export const DEFAULT_CLINIC_PHONE = '+54 263 436-8835'
export const CLINIC_HOURS = 'Lun a Vie de 8 a 20 h · Sáb de 8 a 13 h'
export const GENERAL_WHATSAPP_MESSAGE =
  'Hola, estoy en la web de Clínica Buena Salud y quisiera hacer una consulta sobre turnos.'
export const EMERGENCY_NOTE = 'No es un canal de urgencias. Ante una emergencia llamá al 107 (SAME) o al 911.'

/** Deja solo digitos: wa.me no acepta "+", espacios ni guiones. */
export function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '')
}

/** Link click-to-chat con mensaje precargado. */
export function buildWaUrl(number, text = '') {
  const normalized = normalizePhone(number)
  const query = text ? `?text=${encodeURIComponent(text)}` : ''
  return `https://wa.me/${normalized}${query}`
}

function cleanLine(value, max = 600) {
  return String(value ?? '').replace(/\r/g, '').trim().slice(0, max)
}

/** Mensaje estructurado que recibe la clinica cuando alguien pide un turno. */
export function buildAppointmentRequestMessage(data = {}) {
  const {
    name = '',
    dni = '',
    phone = '',
    specialtyName = '',
    branchName = '',
    preferred = '',
    message = '',
  } = data

  const lines = [
    'Hola, quiero solicitar un turno.',
    '',
    `Nombre y apellido: ${cleanLine(name, 80)}`,
  ]

  if (cleanLine(dni, 30)) lines.push(`DNI: ${cleanLine(dni, 30)}`)
  if (cleanLine(phone, 30)) lines.push(`Teléfono: ${cleanLine(phone, 30)}`)

  lines.push(`Especialidad: ${cleanLine(specialtyName, 80) || 'A definir'}`)

  if (cleanLine(branchName, 80)) lines.push(`Sede: ${cleanLine(branchName, 80)}`)
  if (cleanLine(preferred, 120)) lines.push(`Preferencia horaria: ${cleanLine(preferred, 120)}`)
  if (cleanLine(message, 600)) lines.push(`Consulta: ${cleanLine(message, 600)}`)

  lines.push('', 'Enviado desde la web de Clínica Buena Salud.')
  return lines.join('\n')
}

/** Mensaje con listado de opciones para pedir turno por WhatsApp (click-to-chat). */
export function buildWhatsAppTurnoMessage({ specialties = [], branches = [], name = '', dni = '', preferred = '' } = {}) {
  const lines = [
    'Hola, quiero solicitar un turno por la web.',
    '',
    'Mis datos:',
    `- Nombre y apellido: ${cleanLine(name, 80) || '(completar)'}`,
    `- DNI: ${cleanLine(dni, 30) || '(completar)'}`,
    '',
    'Especialidad (elegir una o indicar cual):',
  ]

  if (specialties.length) {
    specialties.forEach((s, idx) => {
      lines.push(`  ${idx + 1}. ${cleanLine(s.name, 80)}`)
    })
  } else {
    lines.push('  1. Clínica Médica / Cardiología / Pediatría / Dermatología / Traumatología / Ginecología / Oftalmología / Nutrición')
    lines.push('  (o indicar la que necesito)')
  }

  lines.push('', 'Sede (elegir una):')
  if (branches.length) {
    branches.forEach((b, idx) => {
      lines.push(`  ${idx + 1}. ${cleanLine(b.name, 80)}${b.address ? ` - ${cleanLine(b.address, 100)}` : ''}`)
    })
  } else {
    lines.push('  1. Sede Centro')
    lines.push('  2. Sede Norte')
    lines.push('  3. Sede Sur')
  }

  lines.push('', `Preferencia horaria: ${cleanLine(preferred, 120) || '(indicar día/horario)'}`)
  lines.push('', 'Gracias. Quedo a la espera de confirmación.')
  lines.push('', 'Enviado desde la web de Clínica Buena Salud.')
  return lines.join('\n')
}
