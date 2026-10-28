'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarPlus, CheckCheck, ClipboardList, Clock3, CreditCard, Inbox, Loader2, MapPin, MessageCircle, Phone, RefreshCw, Stethoscope, XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClinicalHistoryDialog } from '@/components/clinical-history'
import { api } from '@/lib/api-client'
import { buildWaUrl } from '@/lib/whatsapp'

const STATUS = {
  new: { label: 'Nueva', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  contacted: { label: 'Contactada', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  closed: { label: 'Cerrada', className: 'bg-gray-100 text-gray-700 border-gray-200' },
}

const FILTERS = [
  ['all', 'Todas'],
  ['new', 'Nuevas'],
  ['contacted', 'Contactadas'],
  ['closed', 'Cerradas'],
]

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Info({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-medium text-navy">{value || '-'}</div>
    </div>
  )
}

function replyText(item) {
  const specialty = item.specialtyName ? ` de ${item.specialtyName}` : ''
  return `Hola ${item.name}, somos de Clínica Buena Salud. Recibimos tu solicitud de turno${specialty}. ¿Qué día y horario te quedan cómodos?`
}

export function WhatsAppInbox({ onBook }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [busyId, setBusyId] = useState(null)
  const [historyFor, setHistoryFor] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const res = await api('whatsapp-requests')
      setItems(res.requests || [])
    } catch (e) {
      toast.error(e.message || 'No se pudieron cargar las solicitudes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const counts = useMemo(() => ({
    all: items.length,
    new: items.filter(item => item.status === 'new').length,
    contacted: items.filter(item => item.status === 'contacted').length,
    closed: items.filter(item => item.status === 'closed').length,
  }), [items])

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter(item => item.status === filter)),
    [items, filter],
  )

  async function changeStatus(id, status) {
    setBusyId(id)
    try {
      await api(`whatsapp-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setItems(prev => prev.map(item => (item.id === id ? { ...item, status } : item)))
      toast.success('Solicitud actualizada')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-gold">Centro de ayuda</div>
          <h1 className="mt-1 font-display text-3xl text-navy">Solicitudes de turno</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pedidos recibidos desde la web por WhatsApp. Contactá al paciente para confirmar día y horario.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === key
                ? 'border-emerald-deep bg-emerald-deep text-white'
                : 'border-border bg-card text-muted-foreground hover:text-navy'
            }`}
          >
            {label}
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
              filter === key ? 'bg-white/15 text-white' : 'bg-muted text-muted-foreground'
            }`}>{counts[key]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-40 rounded-xl skeleton" />)}
        </div>
      ) : visible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/40" />
            <div className="mt-3 font-medium text-navy">
              No hay solicitudes {filter === 'all' ? 'todavía' : 'en este estado'}
            </div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Cuando alguien use “Pedir turno por WhatsApp” en el centro de ayuda, el pedido aparece acá.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map(item => (
            <Card key={item.id} className="border-border/60 shadow-soft">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-display text-lg text-navy">{item.name}</div>
                      <Badge className={`border ${STATUS[item.status]?.className || ''}`}>
                        {STATUS[item.status]?.label || item.status}
                      </Badge>
                      {item.patientId && !item.patientHasAccount && (
                        <Badge className="border border-amber-200 bg-amber-100 text-amber-800">
                          Cuenta pendiente
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" /> {formatDate(item.createdAt)}
                      </span>
                      {item.dni && (
                        <span className="inline-flex items-center gap-1">
                          <CreditCard className="h-3.5 w-3.5" /> DNI {item.dni}
                        </span>
                      )}
                      {item.phone && (
                        <a
                          href={`tel:${item.phone.replace(/[^\d+]/g, '')}`}
                          className="inline-flex items-center gap-1 hover:text-navy"
                        >
                          <Phone className="h-3.5 w-3.5" /> {item.phone}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {onBook && (
                      <Button
                        size="sm"
                        className="bg-gold text-navy hover:bg-gold/90"
                        onClick={() => onBook({
                          requestId: item.id,
                          name: item.patientName || item.name,
                          dni: item.dni,
                          phone: item.phone,
                          specialtyId: item.specialtyId || '',
                          branchId: item.branchId || '',
                        })}
                      >
                        <CalendarPlus className="h-3.5 w-3.5" /> Reservar turno
                      </Button>
                    )}
                    {item.patientId && (
                      <Button size="sm" variant="outline" onClick={() => setHistoryFor(item)}>
                        <ClipboardList className="h-3.5 w-3.5" /> Historial
                      </Button>
                    )}
                    <Button asChild size="sm" className="bg-emerald-deep text-white hover:bg-emerald-deep/90">
                      <a href={buildWaUrl(item.phone || '', replyText(item))} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                    </Button>
                    {item.status !== 'contacted' && item.status !== 'closed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => changeStatus(item.id, 'contacted')}
                        disabled={busyId === item.id}
                      >
                        <CheckCheck className="h-3.5 w-3.5" /> Contactada
                      </Button>
                    )}
                    {item.status !== 'closed' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => changeStatus(item.id, 'closed')}
                        disabled={busyId === item.id}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Cerrar
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <Info icon={Stethoscope} label="Especialidad" value={item.specialtyName || 'A definir'} />
                  <Info icon={MapPin} label="Sede" value={item.branchName || 'A definir'} />
                  <Info icon={Clock3} label="Preferencia" value={item.preferred || 'Sin preferencia'} />
                </div>

                {item.message && (
                  <div className="mt-3 whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-foreground">
                    {item.message}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ClinicalHistoryDialog
        open={!!historyFor}
        onOpenChange={o => !o && setHistoryFor(null)}
        patientId={historyFor?.patientId}
      />
    </div>
  )
}
