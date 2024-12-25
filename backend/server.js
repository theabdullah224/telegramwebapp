const express = require("express");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram/tl");
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const input = require("input");
const {
  initializeDatabase,
  createOrUpdateUser,
  saveSession,
  getSession,
  deleteSession
} = require('./db');
require('dotenv').config();

const app = express();
const apiId = Number(process.env.API_ID); 
const apiHash = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const sessionStore = new Map();


function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // If it starts with 92, add the plus
  if (cleaned.startsWith('92')) {
    return '+' + cleaned;
  }
  
  // If it doesn't start with 92, add it
  if (!cleaned.startsWith('92')) {
    cleaned = '92' + cleaned;
  }
  
  return '+' + cleaned;
}

async function sendQRBotNotification(userData) {
  try {
    console.log("Starting bot notification with user data:", userData);
    
    // Format the phone number
    const formattedPhone = formatPhoneNumber(userData.phone_number);
    console.log("Formatted phone number:", formattedPhone);

    const botClient = new TelegramClient(
      new StringSession(""),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        useWSS: false
      }
    );

    await botClient.connect();
    console.log("Bot client connected");

    await botClient.start({
      botAuthToken: BOT_TOKEN
    });
    console.log("Bot started with token");

    const message = `🎉 Welcome to the app!\n\n` +
                   `Login successful for:\n` +
                   `Name: ${userData.first_name} ${userData.last_name || ''}\n` +
                   `Phone: ${formattedPhone || 'Not provided'}\n\n` +
                   `Your account is now connected! 🚀`;

    // Send message using the telegram_id directly
    await botClient.sendMessage(userData.telegram_id.toString(), { message });
    console.log("Message sent successfully");

    await botClient.disconnect();
    console.log("Bot disconnected");
  } catch (error) {
    console.error("Bot notification error:", error);
    // Try alternative method if first attempt fails
    try {
      const api = new Api({
        token: BOT_TOKEN
      });
      
      await api.sendMessage({
        chat_id: userData.telegram_id,
        text: `🎉 Welcome to the app!\n\nLogin successful for:\nName: ${userData.first_name} ${userData.last_name || ''}\nYour account is now connected! 🚀`
      });
      
      console.log("Message sent via alternative method");
    } catch (altError) {
      console.error("Alternative notification method failed:", altError);
    }
  }
}
async function sendBotNotification(userData) {
  try {
    // Initialize bot client
    const botClient = new TelegramClient(
      new StringSession(""),
      apiId,
      apiHash,
      {
        connectionRetries: 5,
        useWSS: false
      }
    );

    await botClient.connect();
    await botClient.start({
      botAuthToken: BOT_TOKEN
    });

    // Create welcome message
    const message = `Your account is now connected to shiro!\n\n` +
      `Shiro will send daily summaries,action items and reminders at 9AM UTC.\n\n` +
      `To change the time, go to Settings->Timezone.\n`;

    //  `Name: ${userData.first_name} ${userData.last_name || ''}\n` +
    //  `Phone: ${userData.phone_number || 'Not provided'}\n\n` +

    // Send message to the user
    await botClient.sendMessage(userData.telegram_id, { message });

    // Disconnect bot client
    await botClient.disconnect();
  } catch (error) {
    console.error("Error sending bot notification:", error);
  }
}

class TelegramAuthService {
  constructor() {
    this.client = null;
    this.phoneCodeHash = null;
    this.session = new StringSession("");
    this.activeQRSessions = new Map();
  }

  async initializeClient(phoneNumber) {
    try {
      if (!phoneNumber || typeof phoneNumber !== 'string') {
        throw new Error('Invalid phone number format');
      }

      const formattedPhoneNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

      this.client = new TelegramClient(this.session, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false
      });

      await this.client.connect();

      const sendCodeResult = await this.client.invoke(
        new Api.auth.SendCode({
          phoneNumber: formattedPhoneNumber,
          apiId: apiId,
          apiHash: apiHash,
          settings: new Api.CodeSettings({})
        })
      );

      this.phoneCodeHash = sendCodeResult.phoneCodeHash;
      return { status: 'success', phoneCodeHash: this.phoneCodeHash };
    } catch (error) {
      console.error("Client Initialization Error:", error);
      throw error;
    }
  }

  async generateQR() {
    try {
      console.log("Starting QR code generation...");

      const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false,
      });

      await client.connect();
      console.log("Client connected successfully");

      return new Promise((resolve, reject) => {
        let timeoutId;

        client.signInUserWithQrCode(
          { apiId, apiHash },
          {
            qrCode: (qrCode) => {
              try {
                console.log("QR code token generated");
                const loginToken = Buffer.from(qrCode.token).toString('base64url');
                const sessionToken = crypto.randomBytes(32).toString('hex');

                // Store the QR session with pending status
                this.activeQRSessions.set(sessionToken, {
                  client: client,
                  session: client.session.save(),
                  status: 'pending',
                  createdAt: new Date()
                });

                console.log(`Created new QR session: ${sessionToken}`);

                if (timeoutId) clearTimeout(timeoutId);

                resolve({
                  loginLink: `tg://login?token=${loginToken}`,
                  sessionToken: sessionToken
                });
              } catch (error) {
                console.error("Error in QR callback:", error);
                reject(error);
              }
              return true;
            },
            onError: (error) => {
              console.error("QR code error:", error);
              reject(error);
              return true;
            },
            onSuccess: async (userCredentials) => {
              try {
                console.log("QR login successful, processing user data...", userCredentials);
                const user = userCredentials.user;

                // Find the matching session token
                for (const [token, session] of this.activeQRSessions.entries()) {
                  if (session.client === client) {
                    console.log(`Found matching session: ${token}`);

                    // Clean and convert telegram_id
                    const telegramId = Number(user.id.value ? user.id.value : user.id.toString());

                    if (isNaN(telegramId)) {
                      throw new Error('Invalid Telegram ID received');
                    }

                   
                    // Prepare user data
                    const userData = {
                      telegram_id: telegramId,
                      first_name: user.firstName || '',
                      last_name: user.lastName || '',
                      phone_number: user.phone || ''
                    };

                    console.log("Preparing to save user data:", userData);

                    await sendQRBotNotification(userData);


                    // Save user to database
                    const savedUser = await createOrUpdateUser(userData);
                    console.log("User saved to database:", savedUser);

                    // Save session to database
                    const sessionData = await saveSession(
                      savedUser.id,
                      token,
                      session.client.session.save()
                    );
                    console.log("Session saved to database:", sessionData);

                    // Update QR session status
                    this.activeQRSessions.set(token, {
                      ...session,
                      status: 'authenticated',
                      userData: userData
                    });

                    console.log("QR session updated with authenticated status");
                    break;
                  }
                }
              } catch (error) {
                console.error("Error in QR login success handler:", error);
                throw error;
              }
              return true;
            }
          }
        );

        timeoutId = setTimeout(() => {
          reject(new Error("QR code generation timed out"));
          client.disconnect();
        }, 60000);
      });
    } catch (error) {
      console.error("QR Generation Error:", error);
      throw error;
    }
  }

  async checkSession(sessionToken) {
    try {
      console.log("Checking session for token:", sessionToken);
      const qrSession = this.activeQRSessions.get(sessionToken);
      if (qrSession) {
        console.log("Found QR session with status:", qrSession.status);

        if (qrSession.status === 'authenticated') {
          return {
            isActive: true,
            user: qrSession.userData
          };
        } else {
          try {
            const isAuthorized = await qrSession.client.isUserAuthorized();
            if (isAuthorized) {
              const me = await qrSession.client.getMe();
              const userData = {
                telegram_id: Number(me.id.toString()),
                first_name: me.firstName || '',
                last_name: me.lastName || '',
                phone_number: me.phone || ''
              };
              const savedUser = await createOrUpdateUser(userData);
              await saveSession(
                savedUser.id,
                sessionToken,
                qrSession.client.session.save()
              );
              this.activeQRSessions.set(sessionToken, {
                ...qrSession,
                status: 'authenticated',
                userData: userData
              });

              return {
                isActive: true,
                user: userData
              };
            }
          } catch (error) {
            console.error("Error checking client authorization:", error);
          }
        }
      }

      // Then check database
      const dbSession = await getSession(sessionToken);
      if (dbSession) {
        console.log("Found database session");
        return {
          isActive: true,
          user: {
            telegram_id: dbSession.telegram_id,
            first_name: dbSession.first_name,
            last_name: dbSession.last_name,
            phone_number: dbSession.phone_number
          }
        };
      }

      console.log("No session found");
      return { isActive: false };
    } catch (error) {
      console.error("Session check error:", error);
      return { isActive: false };
    }
  }
  async validateOTP(phoneNumber, otp, phoneCodeHash) {
    try {
      if (!phoneNumber || !otp || !phoneCodeHash) {
        throw new Error('Missing required authentication parameters');
      }

      const formattedPhoneNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

      const validationClient = new TelegramClient(this.session, apiId, apiHash, {
        connectionRetries: 5
      });

      await validationClient.connect();

      const signInResult = await validationClient.invoke(
        new Api.auth.SignIn({
          phoneNumber: formattedPhoneNumber,
          phoneCodeHash: phoneCodeHash,
          phoneCode: otp
        })
      );

      const sessionToken = crypto.randomBytes(32).toString('hex');

      // Clean and convert the telegram_id to a proper number
      const telegramId = Number(signInResult.user.id.toString().replace(/['"]+/g, ''));

      if (isNaN(telegramId)) {
        throw new Error('Invalid Telegram ID received');
      }

      // Save user data to database with cleaned telegram_id
      const userData = {
        telegram_id: telegramId,
        first_name: signInResult.user.firstName,
        last_name: signInResult.user.lastName,
        phone_number: formattedPhoneNumber
      };

      const user = await createOrUpdateUser(userData);

      // Save session to database
      await saveSession(
        user.id,
        sessionToken,
        validationClient.session.save()
      );

      // Update the session store
      sessionStore.set(sessionToken, {
        session: validationClient.session.save(),
        client: validationClient
      });
      await sendBotNotification(userData);

      return {
        status: 'success',
        sessionToken: sessionToken,
        user: {
          id: telegramId,
          firstName: signInResult.user.firstName,
          lastName: signInResult.user.lastName
        }
      };
    } catch (error) {
      console.error("OTP Validation Error:", error);
      if (error.message.includes('invalid input syntax for type bigint')) {
        throw new Error('Invalid Telegram ID format received from authentication');
      }
      throw error;
    }
  }

  async getAuthenticatedClient(sessionToken) {
    try {
      console.log("Getting authenticated client for session:", sessionToken);
      const sessionData = sessionStore.get(sessionToken);

      if (!sessionData) {
        console.log("No session data found for token:", sessionToken);
        throw new Error('Invalid session');
      }

      const client = new TelegramClient(
        new StringSession(sessionData.session),
        apiId,
        apiHash,
        {
          connectionRetries: 5,
          useWSS: false
        }
      );

      await client.connect();
      return client;
    } catch (error) {
      console.error("Error getting authenticated client:", error);
      throw error;
    }
  }

}
app.use(cors({
  origin: '*',
  // credentials: true
}));
app.use(bodyParser.json());

const telegramAuthService = new TelegramAuthService();

app.get('/generate-qr', async (req, res) => {
  try {
    console.log("Received QR code generation request");
    const result = await telegramAuthService.generateQR();
    console.log("QR code generated successfully:", result);
    res.json(result);
  } catch (error) {
    console.error("Failed to generate QR code:", error);
    res.status(500).json({
      error: 'Failed to generate QR code',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/check-session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("Received check session request with auth header:", authHeader);

    if (!authHeader) {
      console.log("No authorization header provided");
      return res.json({ isActive: false });
    }

    const sessionToken = authHeader.split(' ')[1];
    console.log("Extracted session token:", sessionToken);

    const result = await telegramAuthService.checkSession(sessionToken);
    console.log("Session check result:", result);

    res.json(result);
  } catch (error) {
    console.error("Error checking session:", error);
    res.status(500).json({
      error: 'Failed to check session',
      message: error.message
    });
  }
});

app.get('/debug/sessions', (req, res) => {
  const sessions = Array.from(sessionStore.keys());
  res.json({
    activeSessions: sessions.length,
    sessions: sessions
  });
});

app.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const result = await telegramAuthService.initializeClient(phoneNumber);
    res.json({
      status: 'success',
      message: 'OTP sent successfully',
      phoneCodeHash: result.phoneCodeHash
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to send OTP'
    });
  }
});

app.post('/validate-otp', async (req, res) => {
  try {
    const { phoneNumber, otp, phoneCodeHash } = req.body;
    const result = await telegramAuthService.validateOTP(phoneNumber, otp, phoneCodeHash);
    res.json({
      status: 'success',
      message: 'OTP validated successfully',
      sessionToken: result.sessionToken,
      user: result.user
    });
  } catch (error) {
    res.status(400).json({
      status: 'error',
      message: error.message || 'Invalid OTP'
    });
  }
});

app.post('/verify-qr-login', async (req, res) => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json({
        status: 'error',
        message: 'Session token is required'
      });
    }

    // Get session data from database
    const sessionData = await getSession(sessionToken);
    if (!sessionData) {
      return res.status(404).json({
        status: 'error',
        message: 'Session not found'
      });
    }

    res.json({
      status: 'success',
      user: {
        telegram_id: sessionData.telegram_id,
        first_name: sessionData.first_name,
        last_name: sessionData.last_name,
        phone_number: sessionData.phone_number
      },
      sessionToken: sessionToken
    });

  } catch (error) {
    console.error("Error verifying QR login:", error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to verify QR login'
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  try {
    await initializeDatabase();
    console.log(`Server running on port ${PORT}`);
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
});

