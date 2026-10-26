'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowLeft, CalendarPlus, CheckCircle2, ChevronRight, Clock,
  Copy, Loader2, MessageCircle, Phone, Send, ShieldCheck, X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { api } from '@/lib/api-client'
import { FAQS } from '@/lib/faq'
import {
  CLINIC_HOURS, DEFAULT_CLINIC_PHONE, DEFAULT_WHATSAPP_NUMBER, EMERGENCY_NOTE,
  GENERAL_WHATSAPP_MESSAGE, buildAppointmentRequestMessage, buildWaUrl, buildWhatsAppTurnoMessage, normalizePhone,
} from '@/lib/whatsapp'

const WHATSAPP_NUMBER = normalizePhone(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER)
const CLINIC_PHONE = process.env.NEXT_PUBLIC_CLINIC_PHONE || DEFAULT_CLINIC_PHONE
const CLINIC_PHONE_TEL = CLINIC_PHONE.replace(/[^\d+]/g, '')
const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const EMPTY_FORM = {
  name: '',
  dni: '',
  phone: '',
  specialtyId: '',
  branchId: '',
  preferred: '',
  message: '',
  website: '',
}

function QuickAction({ icon: Icon, title, subtitle, onClick, href, accent = false }) {
  const isExternal = typeof href === 'string' && href.startsWith('http')
  const shared = {
    className: `group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-soft ${
      accent
        ? 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50'
        : 'border-border/70 bg-card hover:bg-muted/40'
    }`,
  }
  const content = (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        accent ? 'bg-emerald-deep text-white' : 'bg-muted text-emerald-deep'
      }`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-navy">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </>
  )

  if (href) {
    return (
      <a
        {...shared}
        href={href}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {content}
      </a>
    )
  }

  return (
    <button type="button" {...shared} onClick={onClick}>
      {content}
    </button>
  )
}

export function HelpWidget({ onBook, user }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('home') // home | form | success
  const [specialties, setSpecialties] = useState([])
  const [branches, setBranches] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const panelRef = useRef(null)
  const contentRef = useRef(null)
  const loadedRef = useRef(false)

  // Carga las opciones del formulario una sola vez, al abrir el widget.
  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    Promise.allSettled([api('specialties'), api('branches')]).then(([spec, branch]) => {
      if (spec.status === 'fulfilled') setSpecialties(spec.value.specialties || [])
      if (branch.status === 'fulfilled') setBranches(branch.value.branches || [])
    })
  }, [open])

  // Si hay sesión, precarga nombre y teléfono (evita el teléfono cifrado del registro).
  useEffect(() => {
    if (!open || !user) return
    const safePhone = user.phone && !String(user.phone).startsWith('enc:v1:') ? user.phone : ''
    const safeDni = user.dni && !String(user.dni).startsWith('enc:v1:') ? user.dni : ''
    setForm(prev => ({
      ...prev,
      name: prev.name || user.name || '',
      phone: prev.phone || safePhone,
      dni: prev.dni || safeDni,
    }))
  }, [open, user])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event) => { if (event.key === 'Escape') closeWidget() }
    window.addEventListener('keydown', onKeyDown)
    const timer = window.setTimeout(() => panelRef.current?.focus(), 60)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Al cambiar de vista o volver a abrir el panel, el contenido empieza arriba.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [view, open])

  function closeWidget() {
    setOpen(false)
    setView('home')
    setResult(null)
  }

  function toggleWidget() {
    if (open) closeWidget()
    else setOpen(true)
  }

  const setField = (key) => (event) => {
    setForm(prev => ({ ...prev, [key]: event.target.value }))
  }

  async function submitRequest(event) {
    event.preventDefault()
    if (form.website) return // honeypot

    if (form.name.trim().length < 2) {
      toast.error('Ingresá tu nombre y apellido')
      return
    }
    if (form.dni.trim().replace(/\D/g, '').length < 4) {
      toast.error('Ingresá un DNI válido')
      return
    }

    const specialtyName = specialties.find(s => s.id === form.specialtyId)?.name || ''
    const branchName = branches.find(b => b.id === form.branchId)?.name || ''
    const fallbackMessage = buildAppointmentRequestMessage({ ...form, specialtyName, branchName })

    setSubmitting(true)
    try {
      const res = await api('whatsapp-requests', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setResult({ ...res, message: res.message || fallbackMessage })
      setView('success')
      toast.success('Solicitud registrada')
    } catch (e) {
      // La solicitud no se guardó, pero el mensaje de WhatsApp sigue siendo utilizable.
      setResult({
        waUrl: buildWaUrl(WHATSAPP_NUMBER, fallbackMessage),
        message: fallbackMessage,
        fallback: true,
      })
      setView('success')
      toast.error(e.message || 'No se pudo guardar la solicitud')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyMessage() {
    if (!result?.message) return
    try {
      await navigator.clipboard.writeText(result.message)
      toast.success('Mensaje copiado')
    } catch {
      toast.error('No se pudo copiar el mensaje')
    }
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            id="help-widget-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="help-widget-title"
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`fixed bottom-24 left-4 right-4 z-50 flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-luxury outline-none sm:left-auto sm:right-5 sm:w-[380px] ${
              view === 'home'
                ? 'max-h-[min(19rem,calc(100vh-8rem))]'
                : 'max-h-[min(34rem,calc(100vh-8rem))]'
            }`}
          >
            <div className="gradient-luxury shrink-0 px-4 pb-2.5 pt-3 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-gold" />
                    <span className="text-[10px] uppercase tracking-[0.25em] text-white/60">Centro de ayuda</span>
                  </div>
                  <h2 id="help-widget-title" className="mt-1 font-display text-base">¿Cómo podemos ayudarte?</h2>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-white/70">
                    Turnos por WhatsApp, online o por teléfono.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeWidget}
                  aria-label="Cerrar ayuda"
                  className="rounded-full p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin overscroll-contain">
              {view === 'home' && (
              <>
                <div className="space-y-2.5 p-4 pb-3">
                  <QuickAction
                    icon={MessageCircle}
                    title="Pedir turno por WhatsApp"
                    subtitle="Elegí especialidad, sede y preferencia horaria"
                    onClick={() => { setResult(null); setForm(EMPTY_FORM); setView('form') }}
                    accent
                  />
                  {onBook && (
                    <QuickAction
                      icon={CalendarPlus}
                      title="Reservar turno online"
                      subtitle="Con cuenta, en menos de un minuto"
                      onClick={() => { closeWidget(); onBook() }}
                    />
                  )}
                  <QuickAction
                    icon={Phone}
                    title="Llamar a la clínica"
                    subtitle={`${CLINIC_PHONE} · ${CLINIC_HOURS}`}
                    href={`tel:${CLINIC_PHONE_TEL}`}
                  />
                </div>

                <div className="px-4 pb-4">
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Clock className="h-3 w-3" /> Preguntas frecuentes
                  </div>
                  <Accordion type="single" collapsible className="w-full">
                    {FAQS.map((faq, index) => (
                      <AccordionItem key={faq.q} value={`faq-${index}`} className="border-border/60">
                        <AccordionTrigger className="py-2 text-left text-[12.5px] font-medium hover:no-underline">
                          {faq.q}
                        </AccordionTrigger>
                        <AccordionContent className="pb-2 text-xs leading-relaxed text-muted-foreground">
                          {faq.a}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>

                  <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{EMERGENCY_NOTE}</span>
                  </div>
                  <div className="mt-2 flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground">
                    <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>Tus datos se usan solo para contactarte por esta solicitud.</span>
                  </div>
                </div>
              </>
            )}

            {view === 'form' && (
              <div className="p-4">
                <button
                  type="button"
                  onClick={() => setView('home')}
                  className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-navy"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Volver
                </button>
                <h3 className="font-display text-lg text-navy">Pedir turno por WhatsApp</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Completá tus datos para armar el mensaje. El número ya viene con el WhatsApp desde el que escribas. Recepción te va a confirmar el turno.
                </p>

                <form onSubmit={submitRequest} className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="hw-name">Nombre y apellido *</Label>
                    <Input
                      id="hw-name"
                      value={form.name}
                      onChange={setField('name')}
                      placeholder="Ej: Ana Pérez"
                      autoComplete="name"
                      maxLength={80}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="hw-dni">DNI *</Label>
                    <Input
                      id="hw-dni"
                      value={form.dni}
                      onChange={setField('dni')}
                      placeholder="Ej: 35.678.910"
                      inputMode="numeric"
                      maxLength={30}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="hw-specialty">Especialidad *</Label>
                      <select
                        id="hw-specialty"
                        value={form.specialtyId}
                        onChange={setField('specialtyId')}
                        className={SELECT_CLASS}
                        required
                      >
                        <option value="">Seleccionar...</option>
                        {specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="hw-branch">Sede *</Label>
                      <select
                        id="hw-branch"
                        value={form.branchId}
                        onChange={setField('branchId')}
                        className={SELECT_CLASS}
                        required
                      >
                        <option value="">Seleccionar...</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="hw-preferred">¿Qué día u horario preferís? *</Label>
                    <Input
                      id="hw-preferred"
                      value={form.preferred}
                      onChange={setField('preferred')}
                      placeholder="Ej: martes por la mañana"
                      maxLength={120}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="hw-message">Consulta o comentario (opcional)</Label>
                    <Textarea
                      id="hw-message"
                      value={form.message}
                      onChange={setField('message')}
                      placeholder="Contanos brevemente qué necesitás. No incluyas datos médicos sensibles."
                      maxLength={600}
                      className="min-h-[70px] resize-none"
                    />
                    <div className="text-right text-[10px] text-muted-foreground">{form.message.length}/600</div>
                  </div>

                  {/* Honeypot anti-bot: invisible para personas. */}
                  <input
                    type="text"
                    name="website"
                    value={form.website}
                    onChange={setField('website')}
                    className="hidden"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                  />

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-emerald-deep text-white hover:bg-emerald-deep/90"
                  >
                    {submitting
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</>
                      : <><MessageCircle className="h-4 w-4" /> Abrir WhatsApp con el pedido</>}
                  </Button>
                  <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
                    Se arma el mensaje con tus datos y las opciones elegidas. Al abrir WhatsApp solo tenés que pulsar Enviar.
                  </p>
                </form>
              </div>
            )}

            {view === 'success' && (
              <div className="p-5 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-deep">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h3 className="mt-3 font-display text-xl text-navy">Solicitud registrada</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {result?.fallback
                    ? 'No pudimos guardarla en el panel, pero el mensaje ya está armado para enviarlo por WhatsApp.'
                    : 'Recepción ya puede ver tu pedido en el panel. Para que llegue a WhatsApp, pulsá el botón y enviá el mensaje.'}
                </p>

                {result?.message && (
                  <pre className="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/50 p-3 text-left text-[11px] leading-relaxed text-foreground">
                    {result.message}
                  </pre>
                )}

                <div className="mt-4 space-y-2">
                  <Button asChild className="w-full bg-emerald-deep text-white hover:bg-emerald-deep/90">
                    <a
                      href={result?.waUrl || buildWaUrl(WHATSAPP_NUMBER, result?.message || GENERAL_WHATSAPP_MESSAGE)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="h-4 w-4" /> Abrir WhatsApp
                    </a>
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={copyMessage}>
                    <Copy className="h-4 w-4" /> Copiar mensaje
                  </Button>
                </div>

                <button
                  type="button"
                  onClick={() => { setResult(null); setForm(EMPTY_FORM); setView('home') }}
                  className="mt-3 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-navy hover:underline"
                >
                  Hacer otra consulta
                </button>
              </div>
            )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-4 right-4 z-40 sm:bottom-5 sm:right-5">
        <button
          type="button"
          onClick={toggleWidget}
          aria-expanded={open}
          aria-controls="help-widget-panel"
          aria-label={open ? 'Cerrar centro de ayuda' : 'Abrir centro de ayuda'}
          className="relative flex h-14 w-14 items-center justify-center rounded-full gradient-luxury text-white shadow-luxury ring-1 ring-white/20 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:w-auto sm:gap-2 sm:px-5"
        >
          {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
          <span className="hidden text-sm font-semibold sm:inline">{open ? 'Cerrar' : 'Ayuda'}</span>
          {!open && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-gold ring-2 ring-background" />}
        </button>
      </div>
    </>
  )
}
