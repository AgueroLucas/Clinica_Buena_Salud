'use client'

import { useEffect, useMemo, useState, useRef, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  Stethoscope, Sparkles, Baby, HeartPulse, Flower2, Bone, Eye, Brain,
  Calendar as CalendarIcon, Clock, MapPin, User, Phone, Mail, ChevronLeft, ChevronRight,
  LogOut, Shield, UserCog, ClipboardList, CheckCircle2, XCircle, Loader2, LayoutDashboard,
  Building2, ArrowRight, Filter, PlusCircle, LogIn, CalendarDays,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { HelpWidget } from '@/components/help-widget'
import { WhatsAppInbox } from '@/components/whatsapp-inbox'
import { ClinicalHistory, ClinicalHistoryDialog } from '@/components/clinical-history'
import { api } from '@/lib/api-client'

const ICONS = { Stethoscope, Sparkles, Baby, HeartPulse, Flower2, Bone, Eye, Brain }
const STATUS_LABEL = {
  pending: 'Pendiente', confirmed: 'Confirmado', in_room: 'En sala',
  attended: 'Atendido', cancelled: 'Cancelado', no_show: 'No asistió',
}
const STATUS_COLOR = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  confirmed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  in_room: 'bg-blue-100 text-blue-800 border-blue-200',
  attended: 'bg-gray-100 text-gray-800 border-gray-200',
  cancelled: 'bg-rose-100 text-rose-800 border-rose-200',
  no_show: 'bg-orange-100 text-orange-800 border-orange-200',
}

/* Cloudflare Turnstile (CAPTCHA). Si NEXT_PUBLIC_TURNSTILE_SITE_KEY no está
   configurado, el widget no se renderiza y el backend tampoco lo exige. */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''

function Captcha({ onVerify }) {
  const containerRef = useRef(null)
  const renderedRef = useRef(false)
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || renderedRef.current || !containerRef.current) return
    renderedRef.current = true
    const render = () => {
      if (!window.turnstile || !containerRef.current) return
      try {
        window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'light',
          callback: (token) => onVerify(token),
          'expired-callback': () => onVerify(null),
          'error-callback': () => onVerify(null),
        })
      } catch {}
    }
    if (window.turnstile) { render(); return }
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = render
    document.body.appendChild(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!TURNSTILE_SITE_KEY) return null
  return <div ref={containerRef} className="mt-2" />
}

function Brand({ dark = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-luxury ${dark ? 'bg-white/10 border border-white/20' : 'gradient-luxury'}`}>
        <Stethoscope className={`w-6 h-6 ${dark ? 'text-gold' : 'text-white'}`} />
      </div>
      <div>
        <div className={`font-display text-xl leading-tight ${dark ? 'text-white' : 'text-navy'}`}>Clínica <span className="text-gold">Buena Salud</span></div>
        <div className={`text-[10px] tracking-[0.3em] uppercase ${dark ? 'text-white/60' : 'text-muted-foreground'}`}>Premium Health Care</div>
      </div>
    </div>
  )
}

function Landing({ onStart, onLogin }) {
  const [dbSpecialties, setDbSpecialties] = useState([])
  useEffect(() => {
    api('specialties').then(r => setDbSpecialties(r.specialties || [])).catch(() => {})
  }, [])
  // Mapea el nombre hardcodeado de la tarjeta al id real de la BD.
  // Si no existe (ej: Neurología), devuelve null y el asistente muestra el paso 1.
  const findSpecialtyId = (name) =>
    dbSpecialties.find(s => s.name.toLowerCase() === name.toLowerCase())?.id || null

  return (
    <div className="min-h-screen bg-background">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
          <Brand dark />
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onLogin} className="text-white hover:bg-white/10 hover:text-gold">
              <LogIn className="w-4 h-4 mr-2" /> Ingresar
            </Button>
            <Button onClick={onStart} className="bg-gold hover:bg-gold/90 text-navy font-semibold shadow-luxury">
              Reservar turno <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </header>

      <section className="relative min-h-[640px] overflow-hidden">
        <div className="absolute inset-0 gradient-luxury" />
        <div
          className="absolute inset-0 opacity-30 mix-blend-luminosity bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1762625570087-6d98fca29531?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHw0fHxjbGluaWMlMjBpbnRlcmlvcnxlbnwwfHx8fDE3ODk1MDgxOTB8MA&ixlib=rb-4.1.0&q=85')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="relative max-w-7xl mx-auto px-6 pt-40 pb-24">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="max-w-2xl">
            <Badge className="bg-white/10 text-gold border border-gold/40 hover:bg-white/10 font-normal tracking-wider">EXCELENCIA MÉDICA • DESDE 1974</Badge>
            <h1 className="font-display text-5xl md:text-7xl text-white mt-6 leading-[1.05]">
              Su salud, <span className="italic text-gold">nuestra prioridad</span>
            </h1>
            <p className="text-white/80 text-lg mt-6 max-w-lg">
              Reserve su turno con médicos de excelencia en nuestras sedes premium. Atención ágil, elegante y personalizada.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button size="lg" onClick={onStart} className="bg-gold hover:bg-gold/90 text-navy font-semibold shadow-luxury">
                <CalendarIcon className="w-5 h-5 mr-2" /> Reservar mi turno
              </Button>
              <Button size="lg" variant="outline" onClick={onLogin} className="bg-white/5 border-white/30 text-white hover:bg-white/15 hover:text-gold">
                Portal de personal
              </Button>
            </div>
            <div className="mt-12 flex flex-wrap items-center gap-8 text-white/70 text-sm">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-gold" /> 40+ especialistas</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-gold" /> 3 sedes exclusivas</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-gold" /> Turnos en 60 segundos</div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <div className="text-gold text-xs tracking-[0.3em] uppercase">Especialidades</div>
          <h2 className="font-display text-4xl md:text-5xl text-navy mt-3">Atención integral, hecha a medida</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { icon: HeartPulse, name: 'Cardiología' }, { icon: Sparkles, name: 'Dermatología' },
            { icon: Baby, name: 'Pediatría' }, { icon: Flower2, name: 'Ginecología' },
            { icon: Bone, name: 'Traumatología' }, { icon: Eye, name: 'Oftalmología' },
            { icon: Brain, name: 'Neurología' }, { icon: Stethoscope, name: 'Clínica Médica' },
          ].map(({ icon: I, name }, i) => (
            <motion.div key={name} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
              <Card className="border-border/60 shadow-soft hover:shadow-luxury hover:-translate-y-1 transition-all group cursor-pointer" onClick={() => onStart(findSpecialtyId(name))}>
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <div className="w-14 h-14 rounded-full gradient-luxury flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <I className="w-6 h-6 text-gold" />
                  </div>
                  <div className="font-display text-lg text-navy">{name}</div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 mt-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <Brand />
          <div>© {new Date().getFullYear()} Clínica Buena Salud — Todos los derechos reservados</div>
        </div>
      </footer>
    </div>
  )
}

function LoginView({ onBack, onLogged }) {
  const [tab, setTab] = useState('patient')
  const [email, setEmail] = useState('')
  const [dni, setDni] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const demos = {
    patient:    { type: 'dni',   value: '35678910', password: 'Paciente@2025!', label: 'Paciente — DNI 35678910' },
    doctor:     { type: 'email', value: 'dr.rossi@clinicabuenasalud.com', password: 'Doctor@2025!', label: 'Médico (2FA obligatorio)' },
    reception:  { type: 'dni',   value: '30111222', password: 'Recepcion@2025!', label: 'Recepción — DNI 30111222' },
    admin:      { type: 'email', value: 'admin@clinicabuenasalud.com', password: 'Admin@2025!', label: 'Administrador (2FA obligatorio)' },
  }
  const [twoFAState, setTwoFAState] = useState(null) // { setup, setupToken?, qr?, secret? }
  const [totpInput, setTotpInput] = useState('')
  const [recovery, setRecovery] = useState(null)
  const [reg, setReg] = useState({ name: '', dni: '', phone: '', captchaToken: null })

  useEffect(() => {
    if (demos[tab]) {
      setEmail(demos[tab].type === 'email' ? demos[tab].value : '')
      setDni(demos[tab].type === 'dni' ? demos[tab].value : '')
      setPassword(demos[tab].password)
    } else if (tab === 'register') {
      setEmail(''); setDni(''); setPassword('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  function credentials() {
    const demo = demos[tab]
    if (demo?.type === 'dni') return { dni }
    if (demo?.type === 'email') return { email }
    return { dni: dni || undefined, email: email || undefined }
  }

  async function submitRegister(e) {
    e?.preventDefault()
    setLoading(true)
    try {
      const res = await api('auth/register', { method: 'POST', body: JSON.stringify({
        name: reg.name, dni: reg.dni, email: email || undefined, password, phone: reg.phone || undefined,
        captchaToken: reg.captchaToken || undefined,
      }) })
      localStorage.setItem('cbs_token', res.token)
      localStorage.setItem('cbs_user', JSON.stringify(res.user))
      toast.success(res.claimedHistory
        ? `Cuenta creada. Vinculamos el historial clínico de tu DNI, ${res.user.name}`
        : `Cuenta creada, bienvenido/a ${res.user.name}`)
      onLogged(res.user)
    } catch (e2) { toast.error(e2.message) }
    finally { setLoading(false) }
  }

  async function submit(e) {
    e?.preventDefault()
    setLoading(true)
    try {
      const res = await api('auth/login', { method: 'POST', body: JSON.stringify({ ...credentials(), password, totp: totpInput || undefined }) })
      if (res.require2FA && res.setup) {
        // Setup 2FA required (admin/doctor first login)
        localStorage.setItem('cbs_setup_token', res.setupToken)
        const setup = await fetch('/api/auth/2fa/setup', { method: 'POST', headers: { Authorization: `Bearer ${res.setupToken}` } }).then(r => r.json())
        setTwoFAState({ setup: true, qr: setup.qr, secret: setup.secret })
        return
      }
      if (res.require2FA && !res.setup) { setTwoFAState({ setup: false }); return }
      localStorage.setItem('cbs_token', res.token)
      localStorage.setItem('cbs_user', JSON.stringify(res.user))
      toast.success(`Bienvenido, ${res.user.name}`)
      onLogged(res.user)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }
  async function verify2FA() {
    setLoading(true)
    try {
      const token = twoFAState.setup ? localStorage.getItem('cbs_setup_token') : null
      if (twoFAState.setup) {
        const res = await fetch('/api/auth/2fa/verify', { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ totp: totpInput }) }).then(r => r.json().then(d => ({ ok: r.ok, ...d })))
        if (!res.ok) { toast.error(res.error || 'Código inválido'); return }
        localStorage.removeItem('cbs_setup_token')
        localStorage.setItem('cbs_token', res.token)
        localStorage.setItem('cbs_user', JSON.stringify(res.user))
        setRecovery(res.recoveryCodes)
      } else {
        const res = await api('auth/login', { method: 'POST', body: JSON.stringify({ ...credentials(), password, totp: totpInput }) })
        localStorage.setItem('cbs_token', res.token)
        localStorage.setItem('cbs_user', JSON.stringify(res.user))
        toast.success('Autenticado')
        onLogged(res.user)
      }
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen gradient-luxury flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 opacity-20 bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1665231795856-769fb08a90bc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA3MDR8MHwxfHNlYXJjaHwyfHxjbGluaWMlMjBpbnRlcmlvcnxlbnwwfHx8fDE3ODk1MDgxOTB8MA&ixlib=rb-4.1.0&q=85')" }} />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-md">
        <div className="text-center mb-6"><Brand dark /></div>
        <Card className="glass shadow-luxury border-white/20">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-2xl text-navy">Ingreso al portal</CardTitle>
            <CardDescription>Pacientes y recepción: DNI + contraseña. Médicos y admin: email.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid grid-cols-5 mb-5 bg-muted/60">
                <TabsTrigger value="patient" className="text-xs">Paciente</TabsTrigger>
                <TabsTrigger value="doctor" className="text-xs">Médico</TabsTrigger>
                <TabsTrigger value="reception" className="text-xs">Recep.</TabsTrigger>
                <TabsTrigger value="admin" className="text-xs">Admin</TabsTrigger>
                <TabsTrigger value="register" className="text-xs">Crear cuenta</TabsTrigger>
              </TabsList>
              {Object.keys(demos).map(k => (
                <TabsContent key={k} value={k}>
                  <form onSubmit={submit} className="space-y-4">
                    {demos[k].type === 'dni' ? (
                      <div>
                        <Label>DNI</Label>
                        <Input
                          value={dni}
                          onChange={e => setDni(e.target.value)}
                          inputMode="numeric"
                          autoComplete="username"
                          placeholder="Ej: 35678910"
                          maxLength={20}
                          className="mt-1"
                          required
                        />
                      </div>
                    ) : (
                      <div>
                        <Label>Email</Label>
                        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1" required />
                      </div>
                    )}
                    <div>
                      <Label>Contraseña</Label>
                      <Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="mt-1" required />
                    </div>
                    <div className="rounded-lg bg-muted/50 border border-border/60 p-3 text-xs text-muted-foreground">
                      Demo pre-cargado: <span className="font-medium text-navy">{demos[k].label}</span>
                      <div className="mt-1">Pacientes y recepción ingresan con DNI + contraseña.</div>
                    </div>
                    <Button type="submit" disabled={loading} className="w-full bg-emerald-deep hover:bg-emerald-deep/90 text-primary-foreground">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ingresar'}
                    </Button>
                  </form>
                </TabsContent>
              ))}
              <TabsContent value="register">
                <form onSubmit={submitRegister} className="space-y-4">
                  <div>
                    <Label>Nombre completo</Label>
                    <Input value={reg.name} onChange={e => setReg(r => ({ ...r, name: e.target.value }))} className="mt-1" required />
                  </div>
                  <div>
                    <Label>DNI</Label>
                    <Input
                      value={reg.dni}
                      onChange={e => setReg(r => ({ ...r, dni: e.target.value }))}
                      inputMode="numeric"
                      placeholder="Ej: 35678910"
                      maxLength={20}
                      className="mt-1"
                      required
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Es tu usuario único. Si ya pediste un turno por WhatsApp con este DNI, tu historial clínico se vincula automáticamente.
                    </div>
                  </div>
                  <div>
                    <Label>Email (opcional)</Label>
                    <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>Contraseña</Label>
                    <Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className="mt-1" required />
                    <div className="text-xs text-muted-foreground mt-1">Mínimo 10 caracteres, con mayúscula, número y símbolo.</div>
                  </div>
                  <div>
                    <Label>Teléfono (opcional)</Label>
                    <Input value={reg.phone} onChange={e => setReg(r => ({ ...r, phone: e.target.value }))} className="mt-1" />
                  </div>
                  <Captcha onVerify={token => setReg(r => ({ ...r, captchaToken: token }))} />
                  <Button type="submit" disabled={loading} className="w-full bg-emerald-deep hover:bg-emerald-deep/90 text-primary-foreground">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear cuenta'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
            <button onClick={onBack} className="text-xs text-muted-foreground hover:text-navy mt-4 w-full text-center">
              ← Volver al inicio
            </button>
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={!!twoFAState} onOpenChange={o => !o && !recovery && (setTwoFAState(null), setTotpInput(''))}>
        <DialogContent className="max-w-md">
          {recovery ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Guarde sus códigos de recuperación</DialogTitle>
                <DialogDescription>Se muestran una sola vez. Guárdelos en un lugar seguro.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 font-mono text-sm p-4 bg-muted/40 rounded-lg">
                {recovery.map((c,i) => <div key={i}>{c}</div>)}
              </div>
              <DialogFooter>
                <Button onClick={() => {
                  const u = JSON.parse(localStorage.getItem('cbs_user'))
                  toast.success('2FA activado')
                  onLogged(u)
                }} className="bg-emerald-deep">Continuar</Button>
              </DialogFooter>
            </>
          ) : twoFAState?.setup ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Configurar 2FA</DialogTitle>
                <DialogDescription>Escanee el QR con Google Authenticator, Authy o 1Password e ingrese el código de 6 dígitos.</DialogDescription>
              </DialogHeader>
              {twoFAState.qr && <img src={twoFAState.qr} alt="QR 2FA" className="mx-auto rounded-lg border" />}
              <div className="text-xs text-center text-muted-foreground font-mono break-all">Secreto: {twoFAState.secret}</div>
              <Input placeholder="Código de 6 dígitos" value={totpInput} onChange={e => setTotpInput(e.target.value)} maxLength={6} />
              <DialogFooter>
                <Button onClick={verify2FA} disabled={loading || totpInput.length < 6} className="bg-emerald-deep">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Activar 2FA'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Verificación 2FA</DialogTitle>
                <DialogDescription>Ingrese el código de 6 dígitos de su aplicación autenticadora.</DialogDescription>
              </DialogHeader>
              <Input placeholder="000000" value={totpInput} onChange={e => setTotpInput(e.target.value)} maxLength={6} className="text-center text-2xl tracking-widest" />
              <DialogFooter>
                <Button onClick={verify2FA} disabled={loading || totpInput.length < 6} className="bg-emerald-deep">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BookingWizard({ user, onDone, initialSpecialtyId = null, prefill = null }) {
  // prefill: reserva gestionada por recepción a partir de una solicitud de
  // WhatsApp. Arranca en el paso más avanzado que permitan los datos cargados.
  const isPatient = user?.role === 'patient'
  const [step, setStep] = useState(
    prefill?.specialtyId && prefill?.branchId ? 3 : (initialSpecialtyId || prefill?.specialtyId) ? 2 : 1,
  )
  const [specialties, setSpecialties] = useState([])
  const [branches, setBranches] = useState([])
  const [doctors, setDoctors] = useState([])
  const [specialtyId, setSpecialtyId] = useState(prefill?.specialtyId || initialSpecialtyId || null)
  const [branchId, setBranchId] = useState(prefill?.branchId || null)
  const [doctor, setDoctor] = useState(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [slots, setSlots] = useState([])
  const [slot, setSlot] = useState(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    name: prefill?.name || (isPatient ? user?.name : '') || '',
    email: prefill?.email || (isPatient ? user?.email : '') || '',
    dni: prefill?.dni || (isPatient ? user?.dni : '') || '',
    phone: prefill?.phone || (isPatient && !String(user?.phone || '').startsWith('enc:v1:') ? user?.phone : '') || '',
    notes: '',
  })
  const [captchaToken, setCaptchaToken] = useState(null)
  const [confirmedAppt, setConfirmedAppt] = useState(null)

  useEffect(() => {
    Promise.all([api('specialties'), api('branches'), api('doctors')]).then(([s, b, d]) => {
      setSpecialties(s.specialties); setBranches(b.branches); setDoctors(d.doctors)
    })
  }, [])

  const filteredDoctors = useMemo(() => doctors.filter(d =>
    (!specialtyId || d.specialtyIds.includes(specialtyId)) &&
    (!branchId || d.branchIds.includes(branchId))
  ), [doctors, specialtyId, branchId])

  useEffect(() => {
    if (step === 4 && doctor && date && branchId) {
      setLoadingSlots(true); setSlot(null)
      api(`doctors/${doctor.id}/availability?date=${date}&branchId=${branchId}`)
        .then(r => setSlots(r.slots))
        .catch(e => toast.error(e.message))
        .finally(() => setLoadingSlots(false))
    }
  }, [step, doctor, date, branchId])

  async function confirm() {
    if (!slot) return
    setSubmitting(true)
    try {
      const body = {
        // Solo un paciente reserva a su propio nombre. Recepción identifica al
        // paciente por DNI y el backend resuelve/crea la ficha correspondiente.
        patientId: isPatient ? user.id : undefined,
        patientName: form.name, patientEmail: form.email || '', patientPhone: form.phone,
        patientDni: form.dni,
        doctorId: doctor.id, specialtyId, branchId,
        date, startTime: slot.startTime, endTime: slot.endTime, notes: form.notes,
        captchaToken: captchaToken || undefined,
      }
      const { appointment } = await api('appointments', { method: 'POST', body: JSON.stringify(body) })
      setConfirmedAppt(appointment)
      // Si la reserva vino de una solicitud de WhatsApp, la marcamos como
      // contactada para que recepción no vuelva a gestionarla.
      if (prefill?.requestId) {
        try {
          await api(`whatsapp-requests/${prefill.requestId}`, {
            method: 'PATCH', body: JSON.stringify({ status: 'contacted' }),
          })
        } catch {}
      }
      toast.success('Turno reservado con éxito')
    } catch (e) { toast.error(e.message) }
    finally { setSubmitting(false) }
  }

  if (confirmedAppt) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="border-emerald-200 shadow-luxury">
            <CardContent className="p-10 text-center">
              <div className="w-20 h-20 rounded-full gradient-luxury mx-auto flex items-center justify-center mb-6 shadow-luxury">
                <CheckCircle2 className="w-10 h-10 text-gold" />
              </div>
              <h2 className="font-display text-3xl text-navy">¡Turno confirmado!</h2>
              <p className="text-muted-foreground mt-2">
                {prefill?.requestId
                  ? 'El turno quedó vinculado al DNI del paciente y la solicitud pasó a Contactada.'
                  : `Recibirá el detalle en ${confirmedAppt.patientEmail || 'su email'}.`}
              </p>
              <div className="mt-8 grid grid-cols-2 gap-4 text-left">
                <div className="p-4 rounded-lg bg-muted/40"><div className="text-xs text-muted-foreground">Médico</div><div className="font-medium">{confirmedAppt.doctorName}</div></div>
                <div className="p-4 rounded-lg bg-muted/40"><div className="text-xs text-muted-foreground">Especialidad</div><div className="font-medium">{confirmedAppt.specialtyName}</div></div>
                <div className="p-4 rounded-lg bg-muted/40"><div className="text-xs text-muted-foreground">Fecha</div><div className="font-medium">{confirmedAppt.date}</div></div>
                <div className="p-4 rounded-lg bg-muted/40"><div className="text-xs text-muted-foreground">Horario</div><div className="font-medium">{confirmedAppt.startTime} - {confirmedAppt.endTime}</div></div>
                <div className="p-4 rounded-lg bg-muted/40 col-span-2"><div className="text-xs text-muted-foreground">Sede</div><div className="font-medium">{confirmedAppt.branchName} • {confirmedAppt.officeName}</div></div>
              </div>
              <div className="mt-8 flex justify-center gap-3">
                <Button variant="outline" onClick={onDone}>Finalizar</Button>
                {!prefill?.requestId && (
                  <Button className="bg-emerald-deep hover:bg-emerald-deep/90" onClick={() => { setConfirmedAppt(null); setStep(1); setDoctor(null); setSlot(null); }}>
                    Reservar otro turno
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  const steps = [
    { n: 1, label: 'Especialidad' }, { n: 2, label: 'Sede' },
    { n: 3, label: 'Médico' }, { n: 4, label: 'Horario' }, { n: 5, label: 'Datos' },
  ]

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl md:text-4xl text-navy">Reservar turno</h1>
        <p className="text-muted-foreground">Complete los pasos para reservar su cita</p>
        {!isPatient && (
          <div className="mt-4 rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Paciente:</span>{' '}
            <span className="font-medium text-navy">{form.name || 'Sin nombre'}</span>
            <span className="mx-2 text-muted-foreground">•</span>
            <span className="text-muted-foreground">DNI</span>{' '}
            <span className="font-medium text-navy">{form.dni || 'Sin DNI'}</span>
            {prefill?.requestId && (
              <Badge className="ml-3 border border-amber-200 bg-amber-100 text-amber-800">Desde solicitud de WhatsApp</Badge>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mb-8 overflow-x-auto no-scrollbar">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2 flex-shrink-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= s.n ? 'bg-emerald-deep text-white' : 'bg-muted text-muted-foreground'}`}>{s.n}</div>
            <div className={`text-sm ${step === s.n ? 'font-semibold text-navy' : 'text-muted-foreground'}`}>{s.label}</div>
            {i < steps.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground mx-1" />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25 }}>
          {step === 1 && (
            <div className="grid md:grid-cols-3 gap-4">
              {specialties.map(s => {
                const I = ICONS[s.icon] || Stethoscope
                const active = specialtyId === s.id
                return (
                  <Card key={s.id} className={`cursor-pointer transition-all hover:shadow-luxury ${active ? 'border-gold ring-2 ring-gold/40' : 'border-border/60'}`}
                    onClick={() => { setSpecialtyId(s.id); setStep(2) }}>
                    <CardContent className="p-6">
                      <div className="w-12 h-12 rounded-full gradient-luxury flex items-center justify-center mb-3"><I className="w-6 h-6 text-gold" /></div>
                      <div className="font-display text-xl text-navy">{s.name}</div>
                      <div className="text-sm text-muted-foreground mt-1">{s.description}</div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
          {step === 2 && (
            <div className="grid md:grid-cols-3 gap-4">
              {branches.map(b => (
                <Card key={b.id} className={`cursor-pointer transition-all hover:shadow-luxury ${branchId === b.id ? 'border-gold ring-2 ring-gold/40' : 'border-border/60'}`}
                  onClick={() => { setBranchId(b.id); setStep(3) }}>
                  <CardContent className="p-6">
                    <Building2 className="w-8 h-8 text-emerald-deep mb-2" />
                    <div className="font-display text-xl text-navy">{b.name}</div>
                    <div className="text-sm text-muted-foreground">{b.address}</div>
                    <div className="text-sm text-muted-foreground">{b.city}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {step === 3 && (
            <div className="grid md:grid-cols-2 gap-4">
              {filteredDoctors.length === 0 && (
                <div className="col-span-2 text-center py-12 text-muted-foreground">No hay médicos disponibles con estos filtros.</div>
              )}
              {filteredDoctors.map(d => (
                <Card key={d.id} className={`cursor-pointer transition-all hover:shadow-luxury ${doctor?.id === d.id ? 'border-gold ring-2 ring-gold/40' : 'border-border/60'}`}
                  onClick={() => { setDoctor(d); setStep(4) }}>
                  <CardContent className="p-6 flex gap-4">
                    <Avatar className="w-14 h-14"><AvatarFallback className="bg-emerald-deep text-gold font-display text-lg">{d.firstName[0]}{d.lastName[0]}</AvatarFallback></Avatar>
                    <div className="flex-1">
                      <div className="font-display text-xl text-navy">Dr/a. {d.firstName} {d.lastName}</div>
                      <div className="text-xs text-gold tracking-wider uppercase">{specialties.find(s => s.id === d.specialtyIds[0])?.name}</div>
                      <div className="text-sm text-muted-foreground mt-2 line-clamp-2">{d.bio}</div>
                      <div className="text-sm text-navy mt-2 font-medium">Consulta: ${d.fee?.toLocaleString('es-AR')}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {step === 4 && (
            <Card className="border-border/60">
              <CardContent className="p-6">
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  <Label className="text-sm">Fecha</Label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} className="w-auto" />
                </div>
                {loadingSlots ? (
                  <div className="grid grid-cols-4 gap-2">{Array.from({ length: 16 }).map((_, i) => <div key={i} className="h-10 rounded skeleton" />)}</div>
                ) : slots.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">No hay disponibilidad en esta fecha.</div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {slots.map((s, i) => (
                      <button key={i} disabled={!s.available}
                        onClick={() => { setSlot(s); setStep(5) }}
                        className={`h-11 rounded-lg text-sm font-medium transition-all border
                        ${slot?.startTime === s.startTime ? 'bg-emerald-deep text-white border-emerald-deep' :
                        s.available ? 'bg-white border-border hover:border-gold hover:bg-gold/5 text-navy' :
                        'bg-muted/50 text-muted-foreground border-transparent line-through cursor-not-allowed'}`}>
                        {s.startTime}
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {step === 5 && (
            <Card className="border-border/60">
              <CardContent className="p-6 grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div><Label>Nombre completo</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" /></div>
                  <div>
                    <Label>DNI</Label>
                    <Input
                      value={form.dni}
                      onChange={e => setForm(f => ({ ...f, dni: e.target.value }))}
                      inputMode="numeric"
                      placeholder="Ej: 35678910"
                      maxLength={20}
                      readOnly={user?.role === 'patient' && !!user?.dni}
                      className="mt-1"
                      required
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      El turno y el historial clínico quedan asociados a este DNI.
                    </div>
                  </div>
                  <div><Label>Email (opcional)</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Teléfono</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Notas para el médico (opcional)</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" rows={3} /></div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-muted/40 to-transparent p-6 border border-border/60">
                  <div className="text-xs tracking-widest uppercase text-gold mb-4">Resumen</div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-3"><User className="w-4 h-4 text-emerald-deep mt-0.5" /><div><div className="text-muted-foreground">Médico</div><div className="font-medium">Dr/a. {doctor?.firstName} {doctor?.lastName}</div></div></div>
                    <div className="flex items-start gap-3"><Sparkles className="w-4 h-4 text-emerald-deep mt-0.5" /><div><div className="text-muted-foreground">Especialidad</div><div className="font-medium">{specialties.find(s => s.id === specialtyId)?.name}</div></div></div>
                    <div className="flex items-start gap-3"><Building2 className="w-4 h-4 text-emerald-deep mt-0.5" /><div><div className="text-muted-foreground">Sede</div><div className="font-medium">{branches.find(b => b.id === branchId)?.name}</div></div></div>
                    <div className="flex items-start gap-3"><CalendarIcon className="w-4 h-4 text-emerald-deep mt-0.5" /><div><div className="text-muted-foreground">Fecha y hora</div><div className="font-medium">{date} • {slot?.startTime} - {slot?.endTime}</div></div></div>
                  </div>
                  <div className="mt-4">
                    <Captcha onVerify={setCaptchaToken} />
                  </div>
                  <Button onClick={confirm} disabled={submitting || (TURNSTILE_SITE_KEY && !captchaToken)} className="w-full mt-4 bg-gold hover:bg-gold/90 text-navy font-semibold">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirmar reserva'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={() => step > 1 ? setStep(step - 1) : onDone()}>
          <ChevronLeft className="w-4 h-4 mr-1" /> {step > 1 ? 'Atrás' : 'Cancelar'}
        </Button>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <Select value={value || 'all'} onValueChange={v => onChange(v === 'all' ? '' : v)}>
        <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o.value || 'all'} value={o.value || 'all'}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

function Row({ icon: I, label, value }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <I className="w-4 h-4 text-emerald-deep mt-0.5 flex-shrink-0" />
      <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>
    </div>
  )
}

function AgendaCalendar() {
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff); d.setHours(0,0,0,0); return d
  })
  const [appointments, setAppointments] = useState([])
  const [doctors, setDoctors] = useState([])
  const [specialties, setSpecialties] = useState([])
  const [branches, setBranches] = useState([])
  const [filters, setFilters] = useState({ doctorId: '', specialtyId: '', branchId: '', status: '' })
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [historyFor, setHistoryFor] = useState(null)

  const days = useMemo(() => Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
  }), [weekStart])

  useEffect(() => {
    Promise.all([api('doctors'), api('specialties'), api('branches')])
      .then(([d, s, b]) => { setDoctors(d.doctors); setSpecialties(s.specialties); setBranches(b.branches) })
  }, [])

  async function reload() {
    setLoading(true)
    try {
      const from = days[0].toISOString().slice(0, 10)
      const to = days[6].toISOString().slice(0, 10)
      const qs = new URLSearchParams({ from, to })
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const { appointments } = await api(`appointments?${qs.toString()}`)
      setAppointments(appointments)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [weekStart, filters])

  const hours = Array.from({ length: 10 }).map((_, i) => 8 + i)

  async function updateStatus(id, status) {
    try {
      await api(`appointments/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast.success('Turno actualizado'); setSelected(null); reload()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl text-navy">Agenda semanal</h1>
          <p className="text-muted-foreground text-sm">Vista general de turnos por sede, médico y especialidad</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }}><ChevronLeft className="w-4 h-4" /></Button>
          <div className="text-sm font-medium min-w-[220px] text-center">
            {days[0].toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} — {days[6].toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          <Button variant="outline" size="icon" onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="ghost" onClick={() => {
            const d = new Date(); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day
            d.setDate(d.getDate() + diff); d.setHours(0,0,0,0); setWeekStart(d)
          }}>Hoy</Button>
        </div>
      </div>

      <Card className="mb-4 border-border/60">
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <FilterSelect label="Especialidad" value={filters.specialtyId} onChange={v => setFilters(f => ({ ...f, specialtyId: v }))}
            options={[{ value: '', label: 'Todas' }, ...specialties.map(s => ({ value: s.id, label: s.name }))]} />
          <FilterSelect label="Sede" value={filters.branchId} onChange={v => setFilters(f => ({ ...f, branchId: v }))}
            options={[{ value: '', label: 'Todas' }, ...branches.map(b => ({ value: b.id, label: b.name }))]} />
          <FilterSelect label="Médico" value={filters.doctorId} onChange={v => setFilters(f => ({ ...f, doctorId: v }))}
            options={[{ value: '', label: 'Todos' }, ...doctors.map(d => ({ value: d.id, label: `Dr/a. ${d.firstName} ${d.lastName}` }))]} />
          <FilterSelect label="Estado" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))}
            options={[{ value: '', label: 'Todos' }, ...Object.entries(STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))]} />
        </CardContent>
      </Card>

      <Card className="border-border/60 overflow-hidden shadow-soft">
        <div className="grid" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
          <div className="bg-muted/40 border-b border-r border-border/60 p-2"></div>
          {days.map((d, i) => {
            const isToday = d.toDateString() === new Date().toDateString()
            return (
              <div key={i} className={`text-center py-3 border-b border-r border-border/60 last:border-r-0 ${isToday ? 'bg-gold/10' : 'bg-muted/40'}`}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{d.toLocaleDateString('es-AR', { weekday: 'short' })}</div>
                <div className={`font-display text-2xl ${isToday ? 'text-gold' : 'text-navy'}`}>{d.getDate()}</div>
              </div>
            )
          })}
          {hours.map(h => (
            <Fragment key={`row-${h}`}>
              <div className="text-xs text-muted-foreground text-right pr-2 py-3 border-b border-r border-border/60">{String(h).padStart(2,'0')}:00</div>
              {days.map((d, i) => {
                const ds = d.toISOString().slice(0, 10)
                const cell = appointments.filter(a => a.date === ds && parseInt(a.startTime.split(':')[0]) === h)
                return (
                  <div key={`c-${h}-${i}`} className="min-h-[70px] border-b border-r border-border/60 last:border-r-0 p-1 space-y-1 relative">
                    {cell.map(a => (
                      <button key={a.id} onClick={() => setSelected(a)}
                        className="w-full text-left rounded-md px-2 py-1.5 text-[11px] leading-tight border shadow-sm hover:shadow-md transition-all bg-white">
                        <div className="font-semibold text-navy truncate">{a.startTime} {a.patientName}</div>
                        <div className="text-muted-foreground truncate">{a.doctorName}</div>
                        <Badge className={`mt-1 border text-[9px] px-1.5 py-0 ${STATUS_COLOR[a.status] || ''}`}>{STATUS_LABEL[a.status]}</Badge>
                      </button>
                    ))}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </Card>
      {loading && <div className="text-center py-4 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Cargando...</div>}

      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Turno de {selected.patientName}</DialogTitle>
                <DialogDescription>{selected.date} • {selected.startTime} - {selected.endTime}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <Row icon={User} label="Médico" value={selected.doctorName} />
                <Row icon={Sparkles} label="Especialidad" value={selected.specialtyName} />
                <Row icon={Building2} label="Sede" value={`${selected.branchName} • ${selected.officeName}`} />
                <Row icon={User} label="DNI" value={selected.patientDni || 'N/A'} />
                <Row icon={Phone} label="Teléfono" value={selected.patientPhone || 'N/A'} />
                <Row icon={Mail} label="Email" value={selected.patientEmail || 'N/A'} />
                {selected.notes && <Row icon={ClipboardList} label="Notas" value={selected.notes} />}
                <div className="pt-2"><Badge className={`border ${STATUS_COLOR[selected.status] || ''}`}>{STATUS_LABEL[selected.status]}</Badge></div>
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {selected.patientId && (
                  <Button size="sm" variant="outline" onClick={() => { setHistoryFor(selected); setSelected(null) }}>
                    <ClipboardList className="mr-1 h-3.5 w-3.5" /> Historial
                  </Button>
                )}
                {selected.status === 'pending' && <Button size="sm" className="bg-emerald-deep hover:bg-emerald-deep/90" onClick={() => updateStatus(selected.id, 'confirmed')}>Confirmar</Button>}
                {['pending','confirmed'].includes(selected.status) && <Button size="sm" variant="outline" onClick={() => updateStatus(selected.id, 'in_room')}>Marcar en sala</Button>}
                {selected.status !== 'attended' && <Button size="sm" variant="outline" onClick={() => updateStatus(selected.id, 'attended')}>Atendido</Button>}
                {selected.status !== 'cancelled' && <Button size="sm" variant="destructive" onClick={() => updateStatus(selected.id, 'cancelled')}>Cancelar</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ClinicalHistoryDialog
        open={!!historyFor}
        onOpenChange={o => !o && setHistoryFor(null)}
        patientId={historyFor?.patientId}
        appointmentId={historyFor?.id}
      />
    </div>
  )
}

function DoctorAgenda({ user }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [historyFor, setHistoryFor] = useState(null)

  async function reload() {
    if (!user?.doctorId) return
    setLoading(true)
    try {
      const { appointments } = await api(`appointments?doctorId=${user.doctorId}&from=${date}&to=${date}`)
      setItems(appointments)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [date, user])

  async function updateStatus(id, status) {
    try {
      await api(`appointments/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      toast.success('Actualizado'); setSelected(null); reload()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl text-navy">Mi agenda</h1>
          <p className="text-muted-foreground text-sm">Bienvenido, {user?.name}</p>
        </div>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
      </div>
      {loading ? (
        <div className="space-y-2">{Array.from({length:5}).map((_,i)=><div key={i} className="h-16 rounded-xl skeleton"/>)}</div>
      ) : items.length === 0 ? (
        <Card className="border-border/60"><CardContent className="p-12 text-center text-muted-foreground">Sin turnos para esta fecha.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map(a => (
            <Card key={a.id} className="border-border/60 hover:shadow-luxury transition-all cursor-pointer" onClick={() => setSelected(a)}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="text-center border-r border-border/60 pr-4">
                  <div className="font-display text-2xl text-navy">{a.startTime}</div>
                  <div className="text-xs text-muted-foreground">{a.endTime}</div>
                </div>
                <Avatar className="w-11 h-11"><AvatarFallback className="bg-emerald-deep text-gold">{a.patientName?.split(' ').map(p => p[0]).slice(0,2).join('')}</AvatarFallback></Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-navy">{a.patientName}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.branchName} • {a.officeName}</div>
                </div>
                <Badge className={`border ${STATUS_COLOR[a.status] || ''}`}>{STATUS_LABEL[a.status]}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader><DialogTitle className="font-display text-2xl">{selected.patientName}</DialogTitle>
                <DialogDescription>{selected.date} • {selected.startTime}</DialogDescription></DialogHeader>
              <div className="space-y-2 text-sm">
                <Row icon={User} label="DNI" value={selected.patientDni || 'N/A'} />
                <Row icon={Phone} label="Teléfono" value={selected.patientPhone || 'N/A'} />
                <Row icon={Mail} label="Email" value={selected.patientEmail || 'N/A'} />
                <Row icon={Building2} label="Sede" value={`${selected.branchName} • ${selected.officeName}`} />
                {selected.notes && <Row icon={ClipboardList} label="Notas" value={selected.notes} />}
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {selected.patientId && (
                  <Button size="sm" variant="outline" onClick={() => { setHistoryFor(selected); setSelected(null) }}>
                    <ClipboardList className="mr-1 h-3.5 w-3.5" /> Historial clínico
                  </Button>
                )}
                {selected.status === 'pending' && <Button size="sm" className="bg-emerald-deep" onClick={() => updateStatus(selected.id, 'confirmed')}>Confirmar</Button>}
                {['pending','confirmed'].includes(selected.status) && <Button size="sm" variant="outline" onClick={() => updateStatus(selected.id, 'in_room')}>En sala</Button>}
                <Button size="sm" variant="outline" onClick={() => updateStatus(selected.id, 'attended')}>Atendido</Button>
                <Button size="sm" variant="destructive" onClick={() => updateStatus(selected.id, 'no_show')}>No asistió</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ClinicalHistoryDialog
        open={!!historyFor}
        onOpenChange={o => !o && setHistoryFor(null)}
        patientId={historyFor?.patientId}
        appointmentId={historyFor?.id}
        canAdd
      />
    </div>
  )
}

function ApptRow({ a, muted }) {
  return (
    <Card className={`border-border/60 ${muted ? 'opacity-70' : ''}`}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="text-center border-r border-border/60 pr-4">
          <div className="text-xs text-muted-foreground uppercase">{new Date(a.date).toLocaleDateString('es-AR',{month:'short'})}</div>
          <div className="font-display text-2xl text-navy">{new Date(a.date).getDate()}</div>
          <div className="text-xs text-muted-foreground">{a.startTime}</div>
        </div>
        <div className="flex-1"><div className="font-medium text-navy">{a.doctorName}</div><div className="text-xs text-muted-foreground">{a.specialtyName} • {a.branchName}</div></div>
        <Badge className={`border ${STATUS_COLOR[a.status] || ''}`}>{STATUS_LABEL[a.status]}</Badge>
      </CardContent>
    </Card>
  )
}

function MyAppointments({ user, onBook, onHistory }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api(`appointments?patientId=${user.id}`).then(r => setItems(r.appointments)).finally(() => setLoading(false))
  }, [user])
  const today = new Date().toISOString().slice(0,10)
  const upcoming = items.filter(a => a.date >= today && !['cancelled','no_show','attended'].includes(a.status))
  const past = items.filter(a => !upcoming.find(u => u.id === a.id))
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="font-display text-3xl text-navy">Mis turnos</h1><p className="text-muted-foreground text-sm">Hola, {user.name}</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onHistory}><ClipboardList className="w-4 h-4 mr-2" />Historial clínico</Button>
          <Button onClick={onBook} className="bg-gold hover:bg-gold/90 text-navy font-semibold"><PlusCircle className="w-4 h-4 mr-2" />Reservar turno</Button>
        </div>
      </div>
      <div className="mb-8">
        <div className="text-xs tracking-widest uppercase text-gold mb-3">Próximos</div>
        {loading ? <div className="h-24 rounded-xl skeleton" /> : upcoming.length === 0 ? (
          <Card className="border-dashed"><CardContent className="p-8 text-center text-muted-foreground">No tienes turnos próximos. ¡Reservá uno!</CardContent></Card>
        ) : (
          <div className="space-y-2">{upcoming.map(a => <ApptRow key={a.id} a={a} />)}</div>
        )}
      </div>
      <div>
        <div className="text-xs tracking-widest uppercase text-muted-foreground mb-3">Historial</div>
        <div className="space-y-2">{past.map(a => <ApptRow key={a.id} a={a} muted />)}</div>
      </div>
    </div>
  )
}

function AdminStats() {
  const [stats, setStats] = useState(null)
  useEffect(() => { api('stats').then(setStats) }, [])
  if (!stats) return <div className="max-w-6xl mx-auto p-8"><div className="h-32 skeleton rounded-xl" /></div>
  const kpis = [
    { label: 'Turnos hoy', value: stats.totalToday, icon: CalendarDays, color: 'text-emerald-deep' },
    { label: 'Confirmados hoy', value: stats.confirmedToday, icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Cancelados hoy', value: stats.cancelledToday, icon: XCircle, color: 'text-rose-500' },
    { label: 'Total histórico', value: stats.total, icon: ClipboardList, color: 'text-gold' },
  ]
  const totalForPct = Math.max(stats.total, 1)
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl text-navy mb-6">Dashboard</h1>
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        {kpis.map(k => (
          <Card key={k.label} className="border-border/60 shadow-soft">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">{k.label}</div>
                <k.icon className={`w-4 h-4 ${k.color}`} />
              </div>
              <div className="font-display text-4xl text-navy">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-border/60"><CardHeader><CardTitle className="font-display">Por especialidad</CardTitle></CardHeader>
          <CardContent className="space-y-2">{stats.bySpecialty.map(x => (
            <div key={x.name || 'x'} className="flex items-center gap-3">
              <div className="text-sm w-32 truncate">{x.name || 'Sin dato'}</div>
              <div className="flex-1 h-2 bg-muted rounded"><div className="h-full bg-emerald-deep rounded" style={{ width: `${(x.count / totalForPct) * 100}%` }} /></div>
              <div className="text-sm font-medium w-8 text-right">{x.count}</div>
            </div>
          ))}</CardContent>
        </Card>
        <Card className="border-border/60"><CardHeader><CardTitle className="font-display">Por estado</CardTitle></CardHeader>
          <CardContent className="space-y-2">{stats.byStatus.map(x => (
            <div key={x.status} className="flex items-center gap-3">
              <Badge className={`border ${STATUS_COLOR[x.status] || ''}`}>{STATUS_LABEL[x.status] || x.status}</Badge>
              <div className="flex-1 h-2 bg-muted rounded"><div className="h-full bg-gold rounded" style={{ width: `${(x.count / totalForPct) * 100}%` }} /></div>
              <div className="text-sm font-medium w-8 text-right">{x.count}</div>
            </div>
          ))}</CardContent>
        </Card>
      </div>
    </div>
  )
}

function AppShell({ user, view, setView, onLogout, children }) {
  const nav = {
    admin:     [['agenda','Agenda'], ['stats','Dashboard'], ['inbox','Solicitudes']],
    reception: [['agenda','Agenda'], ['book','Reservar'], ['inbox','Solicitudes']],
    doctor:    [['doctor','Mi agenda']],
    patient:   [['my','Mis turnos'], ['history','Historial clínico'], ['book','Reservar']],
  }[user.role] || []
  const roleLabels = { admin: 'Administrador', reception: 'Recepción', doctor: 'Médico', patient: 'Paciente' }
  const RoleIcon = { admin: Shield, reception: UserCog, doctor: Stethoscope, patient: User }[user.role] || User

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Brand />
            <nav className="hidden md:flex items-center gap-1">
              {nav.map(([k, label]) => (
                <button key={k} onClick={() => setView(k)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === k ? 'bg-emerald-deep text-white' : 'text-muted-foreground hover:text-navy hover:bg-muted/50'}`}>{label}</button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-sm">
              <RoleIcon className="w-4 h-4 text-gold" />
              <div><div className="font-medium text-navy leading-tight">{user.name}</div><div className="text-xs text-muted-foreground leading-tight">{roleLabels[user.role]}</div></div>
            </div>
            <Button variant="ghost" size="icon" onClick={onLogout} title="Cerrar sesión"><LogOut className="w-4 h-4" /></Button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [view, setView] = useState('landing')
  const [ready, setReady] = useState(false)
  const [bookSpecialtyId, setBookSpecialtyId] = useState(null)
  const [bookingIntent, setBookingIntent] = useState(false)
  const [bookingPrefill, setBookingPrefill] = useState(null)

  // Reservar requiere cuenta: sin sesión se redirige al login conservando la intención
  function startBooking(specialtyId = null) {
    setBookingPrefill(null)
    setBookSpecialtyId(specialtyId || null)
    if (user) { setView('book') }
    else { setBookingIntent(true); setView('login') }
  }

  useEffect(() => {
    api('seed', { method: 'POST' }).catch(() => {})
    const t = localStorage.getItem('cbs_token')
    const u = localStorage.getItem('cbs_user')
    if (t && u) {
      try {
        const parsed = JSON.parse(u)
        setUser(parsed)
        setView(parsed.role === 'patient' ? 'my' : parsed.role === 'doctor' ? 'doctor' : 'agenda')
      } catch {}
    }
    setReady(true)
  }, [])

  function logout() {
    localStorage.removeItem('cbs_token'); localStorage.removeItem('cbs_user')
    setUser(null); setView('landing')
    setBookingIntent(false); setBookSpecialtyId(null)
    toast.success('Sesión cerrada')
  }
  function onLogin(u) {
    setUser(u)
    if (bookingIntent) {
      setBookingIntent(false)
      setView('book')
    } else {
      setView(u.role === 'patient' ? 'my' : u.role === 'doctor' ? 'doctor' : 'agenda')
    }
  }

  if (!ready) return null

  if (!user) {
    if (view === 'login') return (
      <>
        <LoginView onBack={() => { setBookingIntent(false); setView('landing') }} onLogged={onLogin} />
        <HelpWidget onBook={startBooking} />
      </>
    )
    // Reservar turnos requiere cuenta: sin sesión se envía al login conservando la intención
    return (
      <>
        <Landing onStart={startBooking} onLogin={() => setView('login')} />
        <HelpWidget onBook={startBooking} />
      </>
    )
  }

  return (
    <>
      <AppShell user={user} view={view} setView={k => { setBookingPrefill(null); if (k === 'book') setBookSpecialtyId(null); setView(k) }} onLogout={logout}>
        {view === 'agenda' && <AgendaCalendar />}
        {view === 'stats' && <AdminStats />}
        {view === 'inbox' && (
          <WhatsAppInbox onBook={request => { setBookingPrefill(request); setBookSpecialtyId(null); setView('book') }} />
        )}
        {view === 'doctor' && <DoctorAgenda user={user} />}
        {view === 'my' && <MyAppointments user={user} onBook={() => { setBookSpecialtyId(null); setView('book') }} onHistory={() => setView('history')} />}
        {view === 'history' && (
          <div className="max-w-4xl mx-auto px-6 py-10">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="font-display text-3xl text-navy">Historial clínico</h1>
                <p className="text-muted-foreground text-sm">Tus turnos, solicitudes y evoluciones asociadas a tu DNI.</p>
              </div>
              <Button variant="outline" onClick={() => setView('my')}>Volver a mis turnos</Button>
            </div>
            <ClinicalHistory />
          </div>
        )}
        {view === 'book' && (
          <BookingWizard
            key={bookingPrefill?.requestId || bookSpecialtyId || 'general'}
            user={user}
            initialSpecialtyId={bookSpecialtyId}
            prefill={bookingPrefill}
            onDone={() => {
              const fromRequest = !!bookingPrefill?.requestId
              setBookingPrefill(null)
              setBookSpecialtyId(null)
              setView(fromRequest ? 'inbox' : user.role === 'patient' ? 'my' : 'agenda')
            }}
          />
        )}
      </AppShell>
      <HelpWidget onBook={startBooking} user={user} />
    </>
  )
}

export default App
