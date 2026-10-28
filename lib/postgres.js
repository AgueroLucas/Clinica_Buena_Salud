import { Pool } from 'pg'
import { decrypt, encrypt, hashDni, normalizeDni } from './security'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL not defined')

const globalForPostgres = globalThis
const pool = globalForPostgres.__clinicPostgresPool || new Pool({
  connectionString,
  ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  max: 5,
})
globalForPostgres.__clinicPostgresPool = pool

let schemaPromise
const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS documents (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (collection, id)
  );`,
  `CREATE INDEX IF NOT EXISTS documents_collection_idx ON documents (collection);`,
  `CREATE INDEX IF NOT EXISTS appointments_patient_idx
    ON documents ((data->>'patientId')) WHERE collection = 'appointments';`,
  `CREATE INDEX IF NOT EXISTS appointments_doctor_date_idx
    ON documents ((data->>'doctorId'), (data->>'date')) WHERE collection = 'appointments';`,
  `CREATE INDEX IF NOT EXISTS clinical_records_patient_idx
    ON documents ((data->>'patientId')) WHERE collection = 'clinical_records';`,
  `CREATE INDEX IF NOT EXISTS whatsapp_requests_patient_idx
    ON documents ((data->>'patientId')) WHERE collection = 'whatsapp_requests';`,
]

/* El DNI es la clave única de los pacientes. El valor visible se guarda cifrado,
   así que indexamos su hash determinístico (dniHash). */
const uniqueIndexStatements = [
  `CREATE UNIQUE INDEX IF NOT EXISTS users_dni_hash_idx
    ON documents ((data->>'dniHash'))
    WHERE collection = 'users' AND data->>'dniHash' IS NOT NULL AND data->>'dniHash' <> '';`,
  `CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_idx
    ON documents ((data->>'doctorId'), (data->>'date'), (data->>'startTime'))
    WHERE collection = 'appointments';`,
]

/** Completa dniHash en usuarios existentes que solo tienen el DNI cifrado. */
async function backfillDniHashes() {
  const result = await pool.query("SELECT id, data FROM documents WHERE collection = 'users'")
  const usedHashes = new Set(result.rows.map(row => row.data?.dniHash).filter(Boolean))
  const DEFAULT_RECEPTION_DNI = '30111222'

  // Los seeds antiguos no guardaban DNI. Se reconstruye el DNI demo a partir
  // del email para que esas cuentas puedan ingresar con el nuevo esquema.
  function legacySeedDni(user) {
    const email = String(user?.email || '').toLowerCase()
    if (email === 'paciente@ejemplo.com') return '35678910'
    const match = email.match(/^paciente(\d+)@ejemplo\.com$/)
    if (match) {
      const index = Number(match[1]) - 1
      if (index >= 0 && index < 20) return `3${5000000 + index * 13}`
    }
    return ''
  }

  for (const row of result.rows) {
    const user = row.data
    const storedDni = normalizeDni(decrypt(user?.dni))
    if (user?.dniHash && storedDni) continue

    let dni = storedDni
    const update = { ...user }

    // Migración de la cuenta de recepción creada antes del acceso por DNI.
    if (!dni && user?.role === 'reception') {
      const fallbackHash = hashDni(DEFAULT_RECEPTION_DNI)
      if (!usedHashes.has(fallbackHash)) dni = DEFAULT_RECEPTION_DNI
    }
    if (!dni && user?.role === 'patient') dni = legacySeedDni(user)
    if (!dni) continue

    const dniHash = hashDni(dni)
    if (usedHashes.has(dniHash) && user?.dniHash !== dniHash) {
      console.error('DNI duplicado en usuarios, se omite la migración de', row.id)
      continue
    }
    // Si el DNI guardado no se pudo descifrar (clave distinta) se re-cifra.
    if (!storedDni) update.dni = encrypt(dni)
    update.dniHash = dniHash
    try {
      await pool.query(
        'UPDATE documents SET data = $1 WHERE collection = $2 AND id = $3',
        [update, 'users', row.id],
      )
      usedHashes.add(dniHash)
    } catch (error) {
      // Si otro usuario ya tiene ese DNI, no bloqueamos el arranque de la app.
      console.error('No se pudo migrar dniHash para el usuario', row.id, error.code || error.message)
    }
  }
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of schemaStatements) await pool.query(statement)
      await backfillDniHashes()
      for (const statement of uniqueIndexStatements) {
        try {
          await pool.query(statement)
        } catch (error) {
          // Datos históricos duplicados no deben tumbar la aplicación.
          console.error('No se pudo crear un índice único', error.code || error.message)
        }
      }
    })()
  }
  await schemaPromise
}

function sameValue(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  return left === right
}

function matches(document, filter = {}) {
  return Object.entries(filter).every(([field, expected]) => {
    const actual = document[field]
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === '$ne') return !sameValue(actual, value)
        if (operator === '$in') return value.some(item => sameValue(actual, item))
        if (operator === '$nin') return !value.some(item => sameValue(actual, item))
        if (operator === '$gte') return actual >= value
        if (operator === '$lte') return actual <= value
        if (operator === '$gt') return actual > value
        if (operator === '$lt') return actual < value
        return false
      })
    }
    return sameValue(actual, expected)
  })
}

function compareValues(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  return String(left ?? '').localeCompare(String(right ?? ''))
}

class Cursor {
  constructor(documents) {
    this.documents = documents
  }

  sort(specification = {}) {
    const entries = Object.entries(specification)
    this.documents.sort((left, right) => {
      for (const [field, direction] of entries) {
        const result = compareValues(left[field], right[field])
        if (result !== 0) return result * direction
      }
      return 0
    })
    return this
  }

  limit(amount) {
    this.documents = this.documents.slice(0, amount)
    return this
  }

  async toArray() {
    return this.documents.map(document => ({ ...document }))
  }
}

class Collection {
  constructor(name) {
    this.name = name
  }

  async documents() {
    const result = await pool.query('SELECT data FROM documents WHERE collection = $1', [this.name])
    return result.rows.map(row => row.data)
  }

  async findOne(filter = {}) {
    const documents = await this.documents()
    return documents.find(document => matches(document, filter)) || null
  }

  async findDocuments(filter = {}) {
    const documents = await this.documents()
    return documents.filter(document => matches(document, filter))
  }

  find(filter = {}) {
    const pending = this.findDocuments(filter)
    return new AsyncCursor(pending)
  }

  async insertOne(document) {
    await pool.query('INSERT INTO documents (collection, id, data) VALUES ($1, $2, $3)', [this.name, document.id, document])
    return { insertedId: document.id }
  }

  async insertMany(documents) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const document of documents) {
        await client.query('INSERT INTO documents (collection, id, data) VALUES ($1, $2, $3)', [this.name, document.id, document])
      }
      await client.query('COMMIT')
      return { insertedCount: documents.length }
    } catch (error) {
      await client.query('ROLLBACK')
      if (error.code === '23505') error.code = 11000
      throw error
    } finally {
      client.release()
    }
  }

  async updateOne(filter, operation) {
    const document = await this.findOne(filter)
    if (!document) return { matchedCount: 0, modifiedCount: 0 }
    const next = { ...document, ...(operation.$set || {}) }
    for (const field of Object.keys(operation.$unset || {})) delete next[field]
    await pool.query('UPDATE documents SET data = $1 WHERE collection = $2 AND id = $3', [next, this.name, document.id])
    return { matchedCount: 1, modifiedCount: 1 }
  }

  async deleteMany(filter = {}) {
    const documents = await this.findDocuments(filter)
    if (!documents.length) return { deletedCount: 0 }
    await pool.query('DELETE FROM documents WHERE collection = $1 AND id = ANY($2::text[])', [this.name, documents.map(document => document.id)])
    return { deletedCount: documents.length }
  }

  async countDocuments(filter = {}) {
    return (await this.findDocuments(filter)).length
  }

  aggregate(stages = []) {
    const pending = this.documents().then(documents => {
      let result = documents
      for (const stage of stages) {
        if (stage.$group) {
          const field = stage.$group._id.slice(1)
          const groups = new Map()
          for (const document of result) {
            const key = document[field]
            const group = groups.get(key) || { _id: key, count: 0 }
            group.count += 1
            groups.set(key, group)
          }
          result = [...groups.values()]
        }
        if (stage.$sort) {
          const [field, direction] = Object.entries(stage.$sort)[0]
          result.sort((left, right) => (right[field] - left[field]) * direction)
        }
      }
      return result
    })
    return new AsyncCursor(pending)
  }

  async createIndex() {
    return null
  }
}

class AsyncCursor extends Cursor {
  constructor(documentsPromise) {
    super([])
    this.documentsPromise = documentsPromise
    this.operations = []
  }

  sort(specification = {}) {
    this.operations.push(documents => new Cursor(documents).sort(specification).documents)
    return this
  }

  limit(amount) {
    this.operations.push(documents => documents.slice(0, amount))
    return this
  }

  async toArray() {
    this.documents = await this.documentsPromise
    for (const operation of this.operations) this.documents = operation(this.documents)
    return super.toArray()
  }
}

class RelationalDatabase {
  collection(name) {
    return new Collection(name)
  }
}

export async function getDb() {
  await ensureSchema()
  return new RelationalDatabase()
}