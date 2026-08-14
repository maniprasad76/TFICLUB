import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';

/**
 * Payload emitted when an order transitions to CONFIRMED status.
 * Emitted from both OrdersService (COD) and PaymentsService (online payment).
 */
export interface OrderConfirmedEvent {
  orderId: string;
  orderNumber: string;
  totalAmount: number;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string;
  estimatedDelivery: string;
}

/**
 * Payload emitted when an order transitions to SHIPPED status.
 * Emitted from OrdersService.updateStatus when the admin marks an order shipped.
 * `trackingUrl` points to the storefront tracking page (/orders/:id);
 * `trackingId` is the courier tracking ID if the admin provided one.
 */
export interface OrderShippedEvent {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string;
  trackingId: string | null;
  trackingUrl: string | null;
}

/**
 * NotificationService — Provider-agnostic notification dispatcher.
 *
 * Listens for order lifecycle events and dispatches notifications.
 *
 * Transport is config-driven:
 *   - EMAIL_API_URL + EMAIL_API_TOKEN → POST { to, subject, body } with a
 *     Bearer token (works with Resend, Postmark, Brevo, or any HTTP email API)
 *   - otherwise → logs the payload (safe default, no external dependency)
 *
 * Delivery is best-effort: failures are logged and never break the order flow.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly configService: ConfigService) {}

  // ─────────────────────────────────────────────────────────
  // EVENT LISTENERS
  // ─────────────────────────────────────────────────────────

  @OnEvent('order.confirmed', { async: true })
  async handleOrderConfirmed(event: OrderConfirmedEvent) {
    this.logger.log(
      `📬 order.confirmed event — order=${event.orderNumber} customer=${event.customerEmail}`,
    );
  }

  @OnEvent('order.shipped', { async: true })
  async handleOrderShipped(event: OrderShippedEvent) {
    this.logger.log(
      `🚚 order.shipped event — order=${event.orderNumber} customer=${event.customerEmail}`,
    );

    if (event.customerEmail) {
      await this.sendOrderShippedEmail(event);
    } else {
      this.logger.warn(
        `⚠️ No email for order ${event.orderNumber} — skipping email notification`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────
  // EMAIL NOTIFICATION
  // ─────────────────────────────────────────────────────────

  /**
   * Send the "order shipped" email via the configured email transport.
   * Config-driven (EMAIL_API_URL + EMAIL_API_TOKEN); falls back to console.
   */
  private async sendOrderShippedEmail(event: OrderShippedEvent) {
    const subject = `🚚 Your FanClub order ${event.orderNumber} has shipped!`;
    const body = this.composeOrderShippedMessage(event).replace(/\*/g, '');

    try {
      await this.sendEmailMessage(event.customerEmail!, subject, body);
      this.logger.log(
        `✅ Email shipment notification sent for order ${event.orderNumber} → ${event.customerEmail}`,
      );
    } catch (err: any) {
      // Non-blocking: log error but don't fail the order flow
      this.logger.error(
        `❌ Email shipment notification failed for order ${event.orderNumber}: ${err.message}`,
      );
    }
  }

  /**
   * Compose the shipment notification message.
   * Links the customer to the live tracking page (/orders/:id).
   */
  private composeOrderShippedMessage(event: OrderShippedEvent): string {
    const lines = [
      `🚚 Your Order Has Shipped!`,
      ``,
      `Hi ${event.customerName || 'there'},`,
      `Great news — your order *${event.orderNumber}* is on its way!`,
    ];

    if (event.trackingId) {
      // Strip control chars so an odd tracking ID can't garble the message
      const safeTrackingId = event.trackingId.replace(/[\r\n]+/g, ' ');
      lines.push(``, `📦 Tracking ID: ${safeTrackingId}`);
    }
    if (event.trackingUrl) {
      lines.push(``, `🔗 Track your order: ${event.trackingUrl}`);
    }

    lines.push(``, `Thank you for shopping with FanClub! 🏆`);
    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────
  // TRANSPORT LAYER
  // ─────────────────────────────────────────────────────────

  /**
   * Send an email to the given address.
   *
   * Config-driven:
   *   - EMAIL_API_URL + EMAIL_API_TOKEN → POST { to, subject, body } with a
   *     Bearer token (works with Resend, Postmark, Brevo, or any HTTP email API)
   *   - otherwise → logs the payload (safe default, no external dependency)
   */
  private async sendEmailMessage(
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    const apiUrl = this.configService.get<string>('EMAIL_API_URL');
    const apiToken = this.configService.get<string>('EMAIL_API_TOKEN');

    if (!apiUrl || !apiToken) {
      this.logger.log(`📧 [console] Email to ${to}:\nSubject: ${subject}\n\n${body}`);
      return;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ to, subject, body }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Email API responded ${response.status} ${response.statusText} ${detail.slice(0, 200)}`,
      );
    }
  }
}