import { NotificationService, OrderShippedEvent } from './notification.service';

/**
 * NotificationService — order.shipped notification tests.
 * Transport is swapped for a spy; asserts the composed message carries the
 * courier tracking ID and the storefront tracking page link.
 */
describe('NotificationService', () => {
  let service: NotificationService;
  let emailSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new NotificationService({
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    } as any);

    emailSpy = jest
      .spyOn(service as any, 'sendEmailMessage')
      .mockResolvedValue(undefined);
  });

  const shippedEvent: OrderShippedEvent = {
    orderId: 'order-1',
    orderNumber: 'ORD-1001',
    customerName: 'Test Fan',
    customerPhone: '+919000000000',
    customerEmail: 'fan@test.com',
    trackingId: 'TRK-12345',
    trackingUrl: 'https://fanclub.example/orders/order-1',
  };

  it('does not attempt delivery when no email address is available', async () => {
    await (service as any).handleOrderShipped({
      ...shippedEvent,
      customerEmail: '',
    });

    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('sends an email with the tracking link when an email address is available', async () => {
    await (service as any).handleOrderShipped(shippedEvent);

    expect(emailSpy).toHaveBeenCalledTimes(1);
    const [to, subject, body] = emailSpy.mock.calls[0];
    expect(to).toBe('fan@test.com');
    expect(subject).toContain('has shipped');
    expect(body).toContain('https://fanclub.example/orders/order-1');
  });

  it('strips newlines from the tracking ID in the message body', () => {
    const message = (service as any).composeOrderShippedMessage({
      ...shippedEvent,
      trackingId: 'TRK-123\nsecond-line',
    });

    expect(message).not.toContain('\nsecond-line');
    expect(message).toContain('TRK-123 second-line');
  });
});