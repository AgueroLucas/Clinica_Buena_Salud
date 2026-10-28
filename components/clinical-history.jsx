'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays, ClipboardList, CreditCard, FileText, Loader2,
  MapPin, MessageCircle, Phone, PlusCircle, Stethoscope,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api-client'

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

const WA_STATUS = {
  new: { label: 'Nueva', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  contacted: { label: 'Contactada', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  closed: { label: 'Cerrada', className: 'bg-gray-100 text-gray-800 border-gray-200' },
}

const EMPTY_RECORD = { date: '', reason: '', diagnosis: '', treatment: '', notes: '' }

function Summary({ label, value }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-2xl text-navy">{value}</div>
    </div>
  )
}

export function ClinicalHistory({ patientId, canAdd = false, appointmentId = null, onChanged }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_RECORD)
  const [saving, setSaving] = useState(false)

  const url = patientId ? `clinical-history?patientId=${encodeURIComponent(patientId)}` : 'clinical-history'

  async function load() {
    setLoading(true)
    setError('')
    try {
      setData(await api(url))
    } catch (e) {
      setError(e.message || 'No se pudo cargar el historial')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [url])

  async function addRecord(event) {
    event.preventDefault()
    if (!form.reason.trim() && !form.diagnosis.trim() && !form.notes.trim()) {
      toast.error('Completá al menos el motivo, el diagnóstico o las notas')
      return
    }
    setSaving(true)
    try {
      await api('clinical-records', {
        method: 'POST',
        body: JSON.stringify({
          patientId: patientId || data?.patient?.id,
          appointmentId: appointmentId || undefined,
          date: form.date || undefined,
          reason: form.reason,
          diagnosis: form.diagnosis,
          treatment: form.treatment,
          notes: form.notes,
        }),
      })
      toast.success('Evolución agregada al historial clínico')
      setForm(EMPTY_RECORD)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando historial clínico...
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    )
  }

  const patient = data?.patient || {}
  const summary = data?.summary || {}
  const appointments = data?.appointments || []
  const records = data?.records || []
  const whatsappRequests = data?.whatsappRequests || []

  return (
    <div className="space-y-5">
      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-deep text-gold">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl text-navy">{patient.name}</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> DNI {patient.dni || '-'}</span>
              {patient.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {patient.phone}</span>}
              {patient.email && <span>{patient.email}</span>}
            </div>
          </div>
          <Badge className={summary.hasAccount ? 'border border-emerald-200 bg-emerald-100 text-emerald-800' : 'border border-amber-200 bg-amber-100 text-amber-800'}>
            {summary.hasAccount ? 'Cuenta activa' : 'Cuenta pendiente (reclamar con DNI)'}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Summary label="Turnos totales" value={summary.totalAppointments ?? 0} />
        <Summary label="Atendidos" value={summary.attended ?? 0} />
        <Summary label="Próximos" value={summary.upcoming ?? 0} />
        <Summary label="Evoluciones" value={summary.clinicalRecords ?? 0} />
        <Summary label="Solicitudes" value={summary.whatsappRequests ?? 0} />
      </div>

      {canAdd && (
        <Card className="border-emerald-200/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-display text-lg text-navy">
              <PlusCircle className="h-4 w-4 text-emerald-deep" /> Nueva evolución clínica
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addRecord} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Fecha</Label>
                  <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label>Motivo de consulta</Label>
                  <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Ej: control de presión" className="mt-1" />
                </div>
              </div>
              <div>
                <Label>Diagnóstico</Label>
                <Textarea value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} rows={2} className="mt-1" />
              </div>
              <div>
                <Label>Tratamiento indicado</Label>
                <Textarea value={form.treatment} onChange={e => setForm(f => ({ ...f, treatment: e.target.value }))} rows={2} className="mt-1" />
              </div>
              <div>
                <Label>Notas / evolución</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="mt-1" />
              </div>
              <Button type="submit" disabled={saving} className="bg-emerald-deep hover:bg-emerald-deep/90">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><PlusCircle className="h-4 w-4" /> Guardar evolución</>}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div>
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-gold">
          <FileText className="h-3.5 w-3.5" /> Evoluciones clínicas
        </div>
        {records.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Todavía no hay evoluciones cargadas.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {records.map(record => (
              <Card key={record.id} className="border-border/60">
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-navy">
                      <CalendarDays className="h-3.5 w-3.5 text-emerald-deep" /> {record.date}
                    </div>
                    <div className="text-xs text-muted-foreground">{record.doctorName}</div>
                  </div>
                  {record.reason && <div className="text-sm"><span className="text-muted-foreground">Motivo:</span> {record.reason}</div>}
                  {record.diagnosis && <div className="text-sm"><span className="text-muted-foreground">Diagnóstico:</span> {record.diagnosis}</div>}
                  {record.treatment && <div className="text-sm"><span className="text-muted-foreground">Tratamiento:</span> {record.treatment}</div>}
                  {record.notes && <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{record.notes}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Stethoscope className="h-3.5 w-3.5" /> Turnos del paciente
        </div>
        {appointments.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Sin turnos registrados.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {appointments.map(appointment => (
              <Card key={appointment.id} className="border-border/60">
                <CardContent className="flex flex-wrap items-center gap-3 p-3">
                  <div className="text-center">
                    <div className="text-xs uppercase text-muted-foreground">{appointment.date}</div>
                    <div className="font-medium text-navy">{appointment.startTime}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-navy">{appointment.doctorName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {appointment.specialtyName} • {appointment.branchName}
                    </div>
                  </div>
                  <Badge className={`border ${STATUS_COLOR[appointment.status] || ''}`}>
                    {STATUS_LABEL[appointment.status] || appointment.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5" /> Solicitudes de WhatsApp
        </div>
        {whatsappRequests.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Sin solicitudes registradas.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {whatsappRequests.map(request => (
              <Card key={request.id} className="border-border/60">
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-navy">
                      <CalendarDays className="h-3.5 w-3.5 text-emerald-deep" />
                      {String(request.createdAt || '').slice(0, 10) || 'Sin fecha'}
                    </div>
                    <Badge className={`border ${WA_STATUS[request.status]?.className || ''}`}>
                      {WA_STATUS[request.status]?.label || request.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {request.specialtyName && <span>{request.specialtyName}</span>}
                    {request.branchName && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {request.branchName}
                      </span>
                    )}
                    {request.preferred && <span>Preferencia: {request.preferred}</span>}
                  </div>
                  {request.message && (
                    <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{request.message}</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ClinicalHistoryDialog({ open, onOpenChange, patientId, canAdd = false, appointmentId = null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Historial clínico</DialogTitle>
          <DialogDescription>
            Turnos, solicitudes y evoluciones asociadas al DNI del paciente.
          </DialogDescription>
        </DialogHeader>
        {open && <ClinicalHistory patientId={patientId} canAdd={canAdd} appointmentId={appointmentId} />}
      </DialogContent>
    </Dialog>
  )
}
