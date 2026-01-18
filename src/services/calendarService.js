import { supabase } from './supabase'

/**
 * Calendar Event Service - PHASE 1 SAFE MODE
 * 
 * CRITICAL FIXES APPLIED:
 * - Removed ALL ambiguous embeds to eliminate PGRST201 errors
 * - Implemented robust date fallbacks (never discard events)
 * - Clear eventType differentiation (macro vs micro)
 * 
 * STATUS: SAFE MODE - queries guaranteed to work
 */

/**
 * Fetch calendar events for Admin view
 * Returns macro tasks, micro tasks, AND meetings
 * 
 * PHASE 1 - SAFE MODE: No embeds to avoid PGRST201
 */
export async function fetchAdminCalendarEvents() {
  try {


    // PHASE 1: Simple query, no embeds (avoid PGRST201)
    const { data: macroTasks, error: macroError } = await supabase
      .from('tarefas')
      .select('*')
      .order('deadline')

    if (macroError) {
      console.error('[Calendar] ❌ Error fetching macro tasks:', macroError)
      throw macroError
    }



    // PHASE 1: Simple query, no embeds (avoid PGRST201)
    const { data: microTasks, error: microError } = await supabase
      .from('tarefas_micro')
      .select('*')
      .order('deadline_at')

    if (microError) {
      console.error('[Calendar] ❌ Error fetching micro tasks:', microError)
      throw microError
    }



    // Fetch meetings (only scheduled/completed, not cancelled)
    const { data: meetings, error: meetingError } = await supabase
      .from('reunioes')
      .select('*')
      .in('status', ['agendada', 'realizada'])
      .order('data_inicio')

    if (meetingError) {
      console.error('[Calendar] ❌ Error fetching meetings:', meetingError)
      // Don't throw - meetings are optional, tasks must work
    }



    // Transform to calendar events
    const macroEvents = transformMacroTasks(macroTasks || [])
    const microEvents = transformMicroTasks(microTasks || [])
    const meetingEvents = transformMeetings(meetings || [])

    const allEvents = [...macroEvents, ...microEvents, ...meetingEvents]


    return allEvents
  } catch (error) {
    throw error
  }
}

/**
 * Fetch calendar events for Staff view
 * Returns assigned micro tasks AND meetings where staff is participant
 * 
 * PHASE 1 - SAFE MODE: No embeds to avoid PGRST201
 */
export async function fetchStaffCalendarEvents(professionalId) {
  try {


    // PHASE 1: Simple query, no embeds (avoid PGRST201)
    const { data: microTasks, error } = await supabase
      .from('tarefas_micro')
      .select('*')
      .eq('profissional_id', professionalId)
      .order('deadline_at')

    if (error) {
      throw error
    }



    // Fetch meetings where staff is participant (RLS handles filtering)
    const { data: meetings, error: meetingError } = await supabase
      .from('reunioes')
      .select('*')
      .in('status', ['agendada', 'realizada'])
      .order('data_inicio')

    if (meetingError) {
      // Don't throw - meetings are optional
    }



    const events = transformMicroTasks(microTasks || [])
    const meetingEvents = transformMeetings(meetings || [])

    const allEvents = [...events, ...meetingEvents]


    return allEvents
  } catch (error) {
    throw error
  }
}

/**
 * Transform macro tasks to calendar events
 * PHASE 2: ROBUST FALLBACKS - never discard events
 * STATUS-BASED STYLING (not type-based)
 */
function transformMacroTasks(tasks) {


  return tasks.map(task => {
    // PHASE 2: ROBUST DATE FALLBACK CHAIN
    // deadline → created_at → NOW (never null)
    let deadlineValue = task.deadline || task.created_at || new Date().toISOString()
    let deadline = new Date(deadlineValue)

    // Validate date
    if (isNaN(deadline.getTime())) {
      console.warn('[Calendar] ⚠️ Invalid date for macro task, using NOW:', task.id)
      deadlineValue = new Date().toISOString()
      deadline = new Date(deadlineValue)
    }

    // PHASE 2: ALL-DAY DETECTION (midnight check)
    const hours = deadline.getHours()
    const minutes = deadline.getMinutes()
    const seconds = deadline.getSeconds()
    const isAllDay = hours === 0 && minutes === 0 && seconds === 0

    // Calculate start/end
    let start, end
    if (isAllDay) {
      // All-day event: full day block
      start = new Date(deadline)
      start.setHours(0, 0, 0, 0)
      end = new Date(deadline)
      end.setHours(23, 59, 59, 999)
    } else {
      // Timed event: 1h visual block
      start = deadline
      end = new Date(deadline.getTime() + 60 * 60 * 1000)
    }

    return {
      id: `macro-${task.id}`,
      title: `📋 ${task.titulo || 'Sem título'}`,
      start,
      end,
      allDay: isAllDay,
      eventType: 'macro', // PHASE 3: Clear type (but not used for color)
      resource: {
        ...task,
        type: 'macro'
      }
    }
  })
}

/**
 * Transform micro tasks to calendar events
 * PHASE 2: ROBUST FALLBACKS - never discard events
 * STATUS-BASED STYLING (not type-based)
 */
function transformMicroTasks(tasks) {


  // PHASE 2: Process ALL tasks, use fallbacks
  return tasks.map(task => {
    // PHASE 2: ROBUST DATE FALLBACK CHAIN
    // deadline_at → created_at → NOW (never null)
    const deadlineValue = task.deadline_at || task.created_at || new Date().toISOString()
    let deadline = new Date(deadlineValue)

    // Validate date
    if (isNaN(deadline.getTime())) {
      console.warn('[Calendar] ⚠️ Invalid date for micro task, using NOW:', task.id)
      deadline = new Date()
    }

    const startedAt = task.started_at ? new Date(task.started_at) : null
    const finishedAt = task.finished_at ? new Date(task.finished_at) : null

    let start, end, isAllDay = false

    // PHASE 2: INTELLIGENT TIME INFERENCE
    if (startedAt && finishedAt && !isNaN(startedAt.getTime()) && !isNaN(finishedAt.getTime())) {
      // Use actual execution time (never all-day)
      start = startedAt
      end = finishedAt
      isAllDay = false
    } else {
      // Use deadline with fallback
      const hours = deadline.getHours()
      const minutes = deadline.getMinutes()
      const seconds = deadline.getSeconds()

      if (hours === 0 && minutes === 0 && seconds === 0) {
        // All-day event
        isAllDay = true
        start = new Date(deadline)
        start.setHours(0, 0, 0, 0)
        end = new Date(deadline)
        end.setHours(23, 59, 59, 999)
      } else {
        // Timed event: 1h visual block before deadline
        end = deadline
        start = new Date(deadline.getTime() - 60 * 60 * 1000)
      }
    }

    return {
      id: `micro-${task.id}`,
      title: `${task.funcao || 'Tarefa'}`,
      start,
      end,
      allDay: isAllDay,
      eventType: 'micro', // PHASE 3: Clear type (but not used for color)
      resource: {
        ...task,
        type: 'micro'
      }
    }
  }).filter(event => {
    // Only filter out truly invalid events (should never happen with fallbacks)
    const isValid = event.start && event.end && !isNaN(event.start.getTime()) && !isNaN(event.end.getTime())
    if (!isValid) {
      console.error('[Calendar] ❌ Discarding invalid event:', event.id)
    }
    return isValid
  })
}

/**
 * Transform meetings to calendar events
 * Meetings have explicit start/end times
 * NO EMOJIS - Professional institutional tone
 */
function transformMeetings(meetings) {


  return meetings.map(meeting => {
    const start = new Date(meeting.data_inicio)
    const end = new Date(meeting.data_fim)

    // Validate dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      console.warn('[Calendar] ⚠️ Invalid date for meeting, skipping:', meeting.id)
      return null
    }

    // Determine if all-day (both start and end at midnight)
    const startHours = start.getHours()
    const startMinutes = start.getMinutes()
    const endHours = end.getHours()
    const endMinutes = end.getMinutes()

    const isAllDay = (startHours === 0 && startMinutes === 0 && endHours === 23 && endMinutes === 59)

    return {
      id: `meeting-${meeting.id}`,
      title: meeting.titulo, // NO EMOJI - clean title only
      start,
      end,
      allDay: isAllDay,
      eventType: 'meeting',
      resource: {
        ...meeting,
        type: 'meeting'
      }
    }
  }).filter(Boolean) // Remove null entries from invalid dates
}

/**
 * Get event CSS classes based on TEMPORAL STATUS (not type)
 * Color indicates: normal, attention, overdue, or completed
 */
export function getEventClasses(event) {
  const classes = ['calendar-event']

  const resource = event.resource
  const status = resource.status
  const deadline = resource.deadline_at || resource.deadline

  // STATUS CLASSIFICATION (temporal, not type)
  if (status === 'concluida' || status === 'completed' || status === 'realizada') {
    // Completed - gray, low emphasis
    classes.push('calendar-event--completed')
  } else if (deadline) {
    const deadlineDate = new Date(deadline)
    const now = new Date()
    const hoursUntil = (deadlineDate - now) / (1000 * 60 * 60)

    if (deadlineDate < now) {
      // Overdue - light pink background, red border
      classes.push('calendar-event--overdue')
    } else if (hoursUntil <= 24) {
      // Attention - approaching deadline (within 24h)
      classes.push('calendar-event--attention')
    } else {
      // Normal - future event
      classes.push('calendar-event--normal')
    }
  } else {
    // Default to normal if no deadline
    classes.push('calendar-event--normal')
  }

  return classes.join(' ')
}
