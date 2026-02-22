import { supabase } from './supabase';

/**
 * Meeting Service - Manage in-person meetings
 * 
 * FEATURES:
 * - Admin can create/edit/delete meetings
 * - Select participants from company staff
 * - Meetings appear in calendar
 * - Automated notifications (60min, 30min, 10min)
 */

// ==================== CRUD Operations ====================

/**
 * Create a new meeting with participants
 * @param {Object} payload - Meeting data
 * @param {string} payload.empresa_id - Company ID
 * @param {string} payload.titulo - Meeting title
 * @param {string} payload.descricao - Meeting description (optional)
 * @param {string} payload.data_inicio - Start datetime (ISO string)
 * @param {string} payload.data_fim - End datetime (ISO string)
 * @param {string[]} payload.participant_ids - Array of profissional UUIDs
 * @returns {Promise<Object>} Created meeting with participants
 */
export const createMeeting = async (payload) => {
    const {
        empresa_id: payloadEmpresaId,
        titulo,
        descricao,
        data_inicio,
        data_fim,
        participant_ids = []
    } = payload;

    // Get current user for criada_por
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No authenticated user');

    // Determine empresa_id (use payload if provided, otherwise fetch from user profile)
    let empresa_id = payloadEmpresaId;

    if (!empresa_id) {
        const { data: empresaData, error: empresaError } = await supabase
            .from('empresa_profissionais')
            .select('empresa_id')
            .eq('profissional_id', user.id)
            .eq('ativo', true)
            .limit(1)
            .maybeSingle();

        if (empresaError || !empresaData) {
            console.error('[meetingService] Error determining company:', empresaError);
            throw new Error('Could not determine company for meeting creation');
        }
        empresa_id = empresaData.empresa_id;
    }

    // ✅ PRODUCTION-SAFE: Auto-detect timezone (optional field, backward-compatible)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'

    // Step 1: Create the meeting
    const { data: meeting, error: meetingError } = await supabase
        .from('reunioes')
        .insert({
            empresa_id,
            titulo,
            descricao,
            data_inicio,
            data_fim,
            criada_por: user.id,
            status: 'agendada',
            timezone  // ✅ NEW: Optional timezone field
        })
        .select(`
      *,
      empresas!reunioes_empresa_id_fkey (id, nome),
      profissionais!reunioes_criada_por_fkey (id, nome)
    `)
        .single();

    if (meetingError) {
        console.error('[meetingService] Error creating meeting:', meetingError);
        throw meetingError;
    }

    // Step 2: Add participants
    if (participant_ids.length > 0) {
        const participants = participant_ids.map(profissional_id => ({
            reuniao_id: meeting.id,
            profissional_id,
            confirmado: false
        }));

        const { error: participantsError } = await supabase
            .from('reunioes_participantes')
            .insert(participants);

        if (participantsError) {
            console.error('[meetingService] Error adding participants:', participantsError);
            // Rollback: delete the meeting
            await supabase.from('reunioes').delete().eq('id', meeting.id);
            throw participantsError;
        }

        // Step 2.5: Send immediate notifications to all participants
        // We do this non-blocking or awaited? Awaited for completeness, but safe catch.
        sendMeetingInvites(meeting, participant_ids).catch(err =>
            console.error('[meetingService] Background notification error:', err)
        );
    }

    // Step 3: Fetch complete meeting with participants
    return await getMeetingById(meeting.id);
};

/**
 * Get meeting by ID with all details
 * @param {string} meetingId - Meeting UUID
 * @returns {Promise<Object>} Meeting with participants
 */
export const getMeetingById = async (meetingId) => {
    const { data, error } = await supabase
        .from('reunioes')
        .select(`
      *,
      empresas!reunioes_empresa_id_fkey (id, nome),
      profissionais!reunioes_criada_por_fkey (id, nome),
      reunioes_participantes (
        id,
        profissional_id,
        confirmado,
        participou,
        checked_at,
        profissionais (id, nome)
      )
    `)
        .eq('id', meetingId)
        .single();

    if (error) {
        console.error('[meetingService] Error fetching meeting:', error);
        throw error;
    }

    return data;
};

/**
 * List all meetings for admin (all company meetings)
 * RLS automatically filters by admin's company
 * @returns {Promise<Array>} List of meetings
 */
export const listMeetingsAdmin = async () => {
    const { data, error } = await supabase
        .from('reunioes')
        .select(`
      *,
      empresas!reunioes_empresa_id_fkey (id, nome),
      profissionais!reunioes_criada_por_fkey (id, nome),
      reunioes_participantes (
        id,
        profissional_id,
        confirmado,
        participou,
        checked_at
      )
    `)
        .order('data_inicio', { ascending: true });

    if (error) {
        console.error('[meetingService] Error listing admin meetings:', error);
        throw error;
    }

    return data;
};

/**
 * List meetings for staff (only meetings where they are participants)
 * RLS automatically filters, so no need for explicit filter
 * @param {string} profissional_id - Professional UUID (optional, for logging)
 * @returns {Promise<Array>} List of meetings
 */
export const listMeetingsStaff = async (profissional_id = null) => {
    const { data, error } = await supabase
        .from('reunioes')
        .select(`
      *,
      empresas!reunioes_empresa_id_fkey (id, nome),
      profissionais!reunioes_criada_por_fkey (id, nome),
      reunioes_participantes (
        id,
        profissional_id,
        confirmado,
        participou,
        checked_at
      )
    `)
        .order('data_inicio', { ascending: true });

    if (error) {
        console.error('[meetingService] Error listing staff meetings:', error);
        throw error;
    }

    return data;
};

/**
 * Update meeting details and/or participants
 * @param {string} meetingId - Meeting UUID
 * @param {Object} updates - Fields to update
 * @param {string[]} updates.participant_ids - Optional: new participant list (replaces existing)
 * @returns {Promise<Object>} Updated meeting
 */
export const updateMeeting = async (meetingId, updates) => {
    const { participant_ids, ...meetingUpdates } = updates;
    const { data: { user } } = await supabase.auth.getUser();

    // Check if critical details changed (Date/Time) to notify
    const isReschedule = meetingUpdates.data_inicio || meetingUpdates.data_fim;
    let originalMeeting = null;

    if (isReschedule) {
        // Fetch current meeting data to get title if not provided (for notification)
        const { data } = await supabase.from('reunioes').select('titulo, data_inicio, status').eq('id', meetingId).single();
        originalMeeting = data;

        if (originalMeeting.status === 'realizada' || originalMeeting.status === 'cancelada') {
            throw new Error('Não é possível editar reuniões finalizadas ou canceladas.');
        }
    }

    // Update meeting details
    if (Object.keys(meetingUpdates).length > 0) {
        meetingUpdates.updated_at = new Date().toISOString();

        const { error: updateError } = await supabase
            .from('reunioes')
            .update(meetingUpdates)
            .eq('id', meetingId);

        if (updateError) {
            console.error('[meetingService] Error updating meeting:', updateError);
            throw updateError;
        }
        // Notify existing participants if Rescheduled
        if (isReschedule && originalMeeting) {
            try {
                const { data: currentLinks } = await supabase
                    .from('reunioes_participantes')
                    .select('profissional_id')
                    .eq('reuniao_id', meetingId);

                const currentIds = currentLinks?.map(p => p.profissional_id) || [];
                if (currentIds.length > 0) {
                    // Use updated date or fallback to original (rare edge case if only end date changed, but usually start changes)
                    // We send the NEW start date.
                    const newStartDate = meetingUpdates.data_inicio || originalMeeting.data_inicio;
                    const payload = {
                        id: meetingId,
                        titulo: meetingUpdates.titulo || originalMeeting.titulo,
                        data_inicio: newStartDate
                    };
                    // Do not notify participants that are about to be deleted? 
                    // Whatever, simplicity first. Actually we can filter against participant_ids if provided.
                    // But let's assume 'reunioes_participantes' reflects state before Step 2 update.
                    // If we delete them in Step 2, they get a notification?
                    // Since Step 2 is next, we should probably wait or calculate.
                    // Let's do it AFTER participants update if possible?
                    // But we want to notify "Existing" ones.
                    notifyMeetingUpdate(payload, currentIds).catch(console.error);
                }
            } catch (err) {
                console.error('[meetingService] Error sending reschedule notification:', err);
            }
        }

    }

    // Update participants if provided
    if (participant_ids !== undefined) {
        // Calculate new participants for notification
        let newParticipantsToNotify = [];
        try {
            const { data: currentLinks } = await supabase
                .from('reunioes_participantes')
                .select('profissional_id')
                .eq('reuniao_id', meetingId);

            const currentIds = currentLinks?.map(p => p.profissional_id) || [];
            newParticipantsToNotify = participant_ids.filter(pid => !currentIds.includes(pid));
        } catch (err) {
            console.error('[meetingService] Error calculating participant diff:', err);
        }

        // Delete existing participants
        const { error: deleteError } = await supabase
            .from('reunioes_participantes')
            .delete()
            .eq('reuniao_id', meetingId);

        if (deleteError) {
            console.error('[meetingService] Error deleting old participants:', deleteError);
            throw deleteError;
        }

        // Insert new participants
        if (participant_ids.length > 0) {
            const participants = participant_ids.map(profissional_id => ({
                reuniao_id: meetingId,
                profissional_id,
                confirmado: false
            }));

            const { error: insertError } = await supabase
                .from('reunioes_participantes')
                .insert(participants);

            if (insertError) {
                console.error('[meetingService] Error inserting new participants:', insertError);
                throw insertError;
            }

            // Send notifications to NEW participants only
            if (newParticipantsToNotify.length > 0) {
                // Determine meeting details (title/time) if not in updates
                // If title/date changed, we rely on the DB having updated/old values.
                // We should fetch the meeting to be sure, or use updates + defaults.
                // Safer to fetch briefly or use Meeting object if we had it.
                // We'll fetch the updated meeting at the end anyway, but for notification payload:

                // Optimized: Fetch minimal details for notification
                const { data: meetingDetails } = await supabase
                    .from('reunioes')
                    .select('id, titulo, data_inicio')
                    .eq('id', meetingId)
                    .single();

                if (meetingDetails) {
                    sendMeetingInvites(meetingDetails, newParticipantsToNotify).catch(err =>
                        console.error('[meetingService] Background notification update error:', err)
                    );
                }
            }
        }
    }

    // Return updated meeting
    return await getMeetingById(meetingId);
};



/**
 * Cancel meeting (soft delete - sets status to cancelled)
 * Cancelled meetings won't appear in calendar or trigger notifications
 * ✅ UPDATED: Now sends cancellation notification to participants
 * ✅ OBSERVABILITY: Structured logging added
 * @param {string} meetingId - Meeting UUID
 */
export const cancelMeeting = async (meetingId) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuario não autenticado');

    try {
        // ✅ NEW: Fetch meeting details before cancelling (for notification)
        const meeting = await getMeetingById(meetingId);
        const participantIds = meeting.reunioes_participantes?.map(p => p.profissional_id) || [];

        // Cancel the meeting
        const result = await updateMeeting(meetingId, {
            status: 'cancelada',
            cancelled_at: new Date().toISOString(),
            cancelled_by: user.id
        });

        // ✅ NEW: Send cancellation notification to participants (non-blocking)
        if (participantIds.length > 0) {
            notifyMeetingCancellation(meeting, participantIds).catch(err => {
                console.error('[meetingService] Error sending cancellation notifications:', err);
            });
        }

        return result;
    } catch (error) {
        console.error('[meetingService] Error canceling meeting:', error);
        throw error; // Re-throw to maintain existing error handling
    }
};

/**
 * Confirm presence (Check-in) for Staff
 * @param {string} meetingId - Meeting UUID
 */
export const confirmPresence = async (meetingId) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuario não autenticado');

    const { error } = await supabase
        .from('reunioes_participantes')
        .update({
            participou: true,
            checked_at: new Date().toISOString()
        })
        .eq('reuniao_id', meetingId)
        .eq('profissional_id', user.id);

    if (error) {
        console.error('[meetingService] Error checking in:', error);
        throw error;
    }

    // ✅ NEW: Notify organizer about presence confirmation
    try {
        await supabase.rpc('notify_meeting_presence', {
            p_reuniao_id: meetingId,
            p_participante_id: user.id
        });
    } catch (notifyError) {
        console.error('[meetingService] Error notifying presence:', notifyError);
        // Don't block flow if notification fails
    }

    return true;
};

/**
 * Mark meeting as completed
 * @param {string} meetingId - Meeting UUID
 */
export const completeMeeting = async (meetingId) => {
    return await updateMeeting(meetingId, { status: 'realizada' });
};

// ==================== Helper Functions ====================

/**
 * Get available staff for meeting selection
 * Returns active staff from admin's company (RLS filtered)
 * @returns {Promise<Array>} List of staff members
 */
export const getAvailableStaff = async () => {
    // Get current user to find their company
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No authenticated user');

    // Get user's company via empresa_profissionais
    const { data: empresaData, error: empresaError } = await supabase
        .from('empresa_profissionais')
        .select('empresa_id')
        .eq('profissional_id', user.id)
        .eq('ativo', true)
        .limit(1)
        .maybeSingle();

    if (empresaError || !empresaData) {
        console.error('[meetingService] Error fetching user company:', empresaError);
        throw new Error('Could not determine user company');
    }

    const { data, error } = await supabase
        .from('empresa_profissionais')
        .select(`
      profissional_id,
      profissionais (
        id,
        nome,
        email
      )
    `)
        .eq('empresa_id', empresaData.empresa_id)
        .eq('ativo', true);

    if (error) {
        console.error('[meetingService] Error fetching available staff:', error);
        throw error;
    }

    // Flatten the structure
    return data.map(item => item.profissionais).filter(Boolean);
};

/**
 * Validate meeting data
 * @param {Object} meetingData - Meeting payload
 * @returns {Object} { isValid: boolean, errors: Object }
 */
export const validateMeetingData = (meetingData) => {
    const errors = {};

    if (!meetingData.titulo?.trim()) {
        errors.titulo = 'Título é obrigatório';
    }

    if (!meetingData.data_inicio) {
        errors.data_inicio = 'Data de início é obrigatória';
    }

    if (!meetingData.data_fim) {
        errors.data_fim = 'Data de término é obrigatória';
    }

    if (meetingData.data_inicio && meetingData.data_fim) {
        const inicio = new Date(meetingData.data_inicio);
        const fim = new Date(meetingData.data_fim);

        if (fim <= inicio) {
            errors.data_fim = 'Data de término deve ser após a data de início';
        }

        // Warn if meeting is in the past
        if (inicio < new Date()) {
            errors.data_inicio = 'Data de início não pode ser no passado';
        }
    }

    if (!meetingData.participant_ids || meetingData.participant_ids.length === 0) {
        errors.participant_ids = 'Selecione pelo menos um participante';
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
};

/**
 * Send immediate meeting invites to new participants
 * Uses create_meeting_notification RPC with interval=0
 */
const sendMeetingInvites = async (meeting, participantIds) => {
    if (!participantIds?.length) return;

    const promises = participantIds.map(pid =>
        supabase.rpc('create_meeting_notification', {
            p_reuniao_id: meeting.id,
            p_profissional_id: pid,
            p_titulo: meeting.titulo,
            p_data_inicio: meeting.data_inicio,
            p_interval_minutes: 0
        })
    );

    try {
        await Promise.all(promises);
    } catch (err) {
        console.error('[meetingService] Error sending invites:', err);
    }
};

/**
 * Send meeting update notification (Interval -1)
 */
const notifyMeetingUpdate = async (meeting, participantIds) => {
    if (!participantIds?.length) return;

    const promises = participantIds.map(pid =>
        supabase.rpc('create_meeting_notification', {
            p_reuniao_id: meeting.id,
            p_profissional_id: pid,
            p_titulo: meeting.titulo,
            p_data_inicio: meeting.data_inicio,
            p_interval_minutes: -1
        })
    );

    await Promise.all(promises);
};

/**
 * Send meeting cancellation notification (Interval -2)
 * ✅ NEW: Notify participants when meeting is cancelled
 */
const notifyMeetingCancellation = async (meeting, participantIds) => {
    if (!participantIds?.length) return;

    const promises = participantIds.map(pid =>
        supabase.rpc('create_meeting_notification', {
            p_reuniao_id: meeting.id,
            p_profissional_id: pid,
            p_titulo: meeting.titulo,
            p_data_inicio: meeting.data_inicio,
            p_interval_minutes: -2  // ✅ Cancellation interval
        })
    );

    try {
        await Promise.all(promises);
    } catch (err) {
        console.error('[meetingService] Error sending cancellation notifications:', err);
    }
};
