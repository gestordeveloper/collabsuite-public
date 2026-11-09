import { google } from 'googleapis';

// The user must configure these in .env
// GOOGLE_CLIENT_ID
// GOOGLE_CLIENT_SECRET
// GOOGLE_REDIRECT_URI
// GOOGLE_REFRESH_TOKEN (for service-wide operations if using a single account)

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Se houver um token global configurado na ENV
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
}

export const googleCalendarService = {
  getAuthUrl(userId: number) {
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/drive'
      ],
      state: userId.toString(),
      prompt: 'consent'
    });
  },

  async handleCallback(code: string) {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  },

  /**
   * Cria um evento no Google Calendar com link do Google Meet e convida participantes.
   */
  async createMeetEvent(params: {
    summary: string;
    description?: string;
    startDateTime: Date;
    endDateTime: Date;
    guestEmails: string[];
    refreshToken?: string;
  }) {
    const rToken = params.refreshToken || process.env.GOOGLE_REFRESH_TOKEN;
    if (!rToken) {
      console.warn("GOOGLE_REFRESH_TOKEN is not set. Cannot create Meet link automatically.");
      return null;
    }

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ refresh_token: rToken });

    const calendar = google.calendar({ version: 'v3', auth: client });

    const event = {
      summary: params.summary,
      description: params.description || '',
      start: {
        dateTime: params.startDateTime.toISOString(),
      },
      end: {
        dateTime: params.endDateTime.toISOString(),
      },
      attendees: params.guestEmails.map(email => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      }
    };

    try {
      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all', // Ensures emails are sent to guests
      });

      const meetLink = response.data.hangoutLink;
      const eventId = response.data.id;

      return { meetLink, eventId };
    } catch (error) {
      console.error('Error creating Google Meet event:', error);
      throw error;
    }
  }
};
