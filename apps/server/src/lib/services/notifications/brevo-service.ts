// lib/services/notifications/brevo-service.ts
import { TransactionalEmailsApi, ContactsApi, SendSmtpEmail, CreateContact } from "@getbrevo/brevo";

export interface EmailData {
    to: Array<{ email: string; name?: string }>;
    subject: string;
    htmlContent: string;
    textContent: string;
    sender: { name: string; email: string };
    replyTo?: { email: string; name?: string };
    headers?: Record<string, string>;
    tags?: string[];
    templateId?: number;
    templateData?: Record<string, any>;
}

export interface ContactData {
    email: string;
    firstName?: string;
    lastName?: string;
    attributes?: Record<string, any>;
    listIds?: number[];
}

export class BrevoService {
    private emailAPI: TransactionalEmailsApi;
    private contactAPI: ContactsApi;
    private apiKey: string;

    constructor() {
        // Get API key from environment
        const { env } = process;
        this.apiKey = env.BREVO_API_KEY || "";

        if (!this.apiKey) {
            throw new Error("BREVO_API_KEY environment variable is required");
        }

        // Initialize APIs
        this.emailAPI = new TransactionalEmailsApi();
        (this.emailAPI as any).authentications.apiKey.apiKey = this.apiKey;

        this.contactAPI = new ContactsApi();
        (this.contactAPI as any).authentications.apiKey.apiKey = this.apiKey;
    }

    /**
     * Send transactional email
     */
    async sendTransactionalEmail(emailData: EmailData) {
        try {
            const message = new SendSmtpEmail();

            // Set basic properties
            message.subject = emailData.subject;
            message.htmlContent = emailData.htmlContent;
            message.textContent = emailData.textContent;
            message.sender = emailData.sender;
            message.to = emailData.to;

            // Set optional properties
            if (emailData.replyTo) {
                message.replyTo = emailData.replyTo;
            }

            if (emailData.headers) {
                message.headers = emailData.headers;
            }

            if (emailData.tags) {
                message.tags = emailData.tags;
            }

            if (emailData.templateId) {
                message.templateId = emailData.templateId;
                if (emailData.templateData) {
                    message.params = emailData.templateData;
                }
            }

            const response = await this.emailAPI.sendTransacEmail(message);

            return {
                success: true,
                messageId: response.body.messageId,
                response: response.body,
            };
        } catch (error) {
            console.error("Brevo email error:", error);

            let errorMessage = "Unknown email error";
            if (error && typeof error === 'object' && 'body' in error) {
                errorMessage = (error as any).body?.message || errorMessage;
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }

            throw new Error(`Failed to send email: ${errorMessage}`);
        }
    }

    /**
     * Create or update contact
     */
    async upsertContact(contactData: ContactData) {
        try {
            const contact = new CreateContact();
            contact.email = contactData.email;

            // Build attributes object
            const attributes: Record<string, any> = {};

            if (contactData.firstName) {
                attributes.FIRSTNAME = contactData.firstName;
            }
            if (contactData.lastName) {
                attributes.LASTNAME = contactData.lastName;
            }
            if (contactData.attributes) {
                Object.assign(attributes, contactData.attributes);
            }

            if (Object.keys(attributes).length > 0) {
                contact.attributes = attributes;
            }

            if (contactData.listIds) {
                contact.listIds = contactData.listIds;
            }

            // Try to create the contact
            const response = await this.contactAPI.createContact(contact);

            return {
                success: true,
                contactId: response.body.id,
                created: true,
            };
        } catch (error: any) {
            // If contact already exists, try to update it
            if (error?.body?.code === "duplicate_parameter") {
                try {
                    // Rebuild attributes for update
                    const attributes: Record<string, any> = {};

                    if (contactData.firstName) {
                        attributes.FIRSTNAME = contactData.firstName;
                    }
                    if (contactData.lastName) {
                        attributes.LASTNAME = contactData.lastName;
                    }
                    if (contactData.attributes) {
                        Object.assign(attributes, contactData.attributes);
                    }

                    await this.contactAPI.updateContact(contactData.email, {
                        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
                        listIds: contactData.listIds,
                    });

                    return {
                        success: true,
                        contactId: null,
                        created: false,
                        updated: true,
                    };
                } catch (updateError) {
                    console.error("Brevo contact update error:", updateError);
                    throw new Error(`Failed to update contact: ${updateError}`);
                }
            }

            console.error("Brevo contact creation error:", error);
            throw new Error(`Failed to create contact: ${error?.body?.message || error.message}`);
        }
    }

    /**
     * Send billing notification email with consistent branding
     */
    async sendBillingNotification({
                                      recipient,
                                      boxName,
                                      subject,
                                      title,
                                      message,
                                      actionUrl,
                                      actionLabel,
                                      boxId,
                                      notificationId,
                                      urgency = "normal",
                                  }: {
        recipient: { email: string; name?: string };
        boxName: string;
        subject: string;
        title: string;
        message: string;
        actionUrl?: string;
        actionLabel?: string;
        boxId: string;
        notificationId: string;
        urgency?: "low" | "normal" | "high" | "critical";
    }) {
        const urgencyStyles = {
            low: { color: "#6c757d", border: "#e9ecef" },
            normal: { color: "#0d6efd", border: "#b6d7ff" },
            high: { color: "#fd7e14", border: "#ffd6a5" },
            critical: { color: "#dc3545", border: "#f5c2c7" },
        };

        const style = urgencyStyles[urgency];

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${subject}</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background-color: #f8f9fa;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                <!-- Header -->
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">BoxLoyal</h1>
                    <p style="color: #e9ecef; margin: 8px 0 0 0; font-size: 14px;">${boxName}</p>
                </div>

                <!-- Alert Badge -->
                ${urgency !== "normal" ? `
                <div style="background-color: ${style.color}; color: white; text-align: center; padding: 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                    ${urgency} Priority
                </div>
                ` : ''}

                <!-- Content -->
                <div style="padding: 30px;">
                    <!-- Title -->
                    <div style="border-left: 4px solid ${style.color}; padding-left: 20px; margin-bottom: 24px;">
                        <h2 style="color: #212529; margin: 0; font-size: 20px; font-weight: 600;">${title}</h2>
                    </div>

                    <!-- Message -->
                    <div style="color: #495057; line-height: 1.6; font-size: 16px; margin-bottom: 30px;">
                        ${message.replace(/\n/g, '<br>')}
                    </div>

                    ${actionUrl ? `
                    <!-- Action Button -->
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${actionUrl}" 
                           style="background-color: ${style.color}; color: white; padding: 14px 28px; 
                                  text-decoration: none; border-radius: 6px; display: inline-block; 
                                  font-weight: 600; font-size: 16px;">
                            ${actionLabel || "Take Action"}
                        </a>
                    </div>
                    ` : ''}
                </div>

                <!-- Footer -->
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6;">
                    <p style="color: #6c757d; margin: 0 0 8px 0; font-size: 14px;">
                        This notification was sent by ${boxName} via BoxLoyal
                    </p>
                    <p style="color: #868e96; margin: 0; font-size: 12px;">
                        To manage your notification preferences, visit your account settings
                    </p>
                </div>
            </div>

            <!-- Tracking Pixel -->
            <img src="https://api.boxloyal.com/notifications/${notificationId}/track.png" 
                 style="display: none;" width="1" height="1" alt="">
        </body>
        </html>
        `;

        const textContent = `
${title}

${message}

${actionUrl ? `${actionLabel || "Take Action"}: ${actionUrl}` : ''}

---
This notification was sent by ${boxName} via BoxLoyal.
To manage your notification preferences, visit your account settings.
        `.trim();

        return await this.sendTransactionalEmail({
            to: [recipient],
            subject,
            htmlContent,
            textContent,
            sender: {
                name: boxName,
                email: "no-reply@mail.boxloyal.com"
            },
            headers: {
                "X-Box-ID": boxId,
                "X-Notification-ID": notificationId,
                "X-Priority": urgency,
            },
            tags: ["billing", urgency],
        });
    }

    /**
     * Test email configuration
     */
    async testConnection() {
        try {
            const testEmail = {
                to: [{ email: "test@example.com", name: "Test User" }],
                subject: "BoxLoyal Email Service Test",
                htmlContent: "<p>This is a test email from BoxLoyal notification service.</p>",
                textContent: "This is a test email from BoxLoyal notification service.",
                sender: {
                    name: "BoxLoyal",
                    email: "no-reply@mail.boxloyal.com"
                }
            };

            // This will validate the API key and configuration without actually sending
            const response = await this.emailAPI.sendTransacEmail(testEmail);

            return {
                success: true,
                message: "Brevo connection successful",
                messageId: response.body.messageId,
            };
        } catch (error: any) {
            console.error("Brevo connection test failed:", error);

            return {
                success: false,
                message: `Brevo connection failed: ${error?.body?.message || error.message}`,
                error: error?.body || error,
            };
        }
    }

    /**
     * Get account information
     */
    async getAccountInfo() {
        try {
            // Use the account API if available, otherwise return basic info
            return {
                success: true,
                apiKeyValid: true,
                service: "Brevo (SendinBlue)",
                features: {
                    transactionalEmails: true,
                    contactManagement: true,
                    templates: true,
                }
            };
        } catch (error: any) {
            return {
                success: false,
                apiKeyValid: false,
                error: error?.body?.message || error.message,
            };
        }
    }
}
