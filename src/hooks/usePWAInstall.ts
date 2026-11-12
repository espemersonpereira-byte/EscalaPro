import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [swActive, setSwActive] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) setSwActive(true);
      });
      navigator.serviceWorker.ready.then(() => {
        setSwActive(true);
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  const requestPushPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (typeof Notification === 'undefined') {
      return 'denied';
    }
    const perm = await Notification.requestPermission();
    setNotificationPermission(perm);
    return perm;
  }, []);

  const triggerTestNotification = useCallback(
    async (
      customTitle?: string,
      customBody?: string,
      delayMs = 0
    ): Promise<{ ok: boolean; message: string }> => {
      if (typeof Notification === 'undefined') {
        return { ok: false, message: 'Este navegador não suporta a API de Notificações.' };
      }

      let perm = Notification.permission;
      if (perm !== 'granted') {
        perm = await Notification.requestPermission();
        setNotificationPermission(perm);
      }

      if (perm !== 'granted') {
        return {
          ok: false,
          message: 'Permissão de notificação não concedida. Autorize nas configurações do navegador.',
        };
      }

      const sendNow = async () => {
        const title = customTitle || 'EscalaPro — Alerta de Cobertura Hospitalar';
        const body =
          customBody ||
          'Plantão verificado: 1 posto descoberto na próxima troca de turno. Toque para gerenciar a escala.';

        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && 'showNotification' in reg) {
            await reg.showNotification(title, {
              body,
              icon: '/icon.svg',
              badge: '/icon.svg',
              tag: 'escalapro-test-lockscreen',
              requireInteraction: true,
              data: { url: '/?page=escala' },
            });
            return;
          }
        }
        new Notification(title, {
          body,
          icon: '/icon.svg',
          tag: 'escalapro-test-lockscreen',
        });
      };

      if (delayMs > 0) {
        setTimeout(() => {
          sendNow().catch(console.error);
        }, delayMs);
        return {
          ok: true,
          message: `Alerta agendado para disparar em ${Math.round(delayMs / 1000)} segundos. Bloqueie a tela do celular agora para testar!`,
        };
      }

      await sendNow();
      return {
        ok: true,
        message: 'Notificação real disparada via Service Worker com sucesso!',
      };
    },
    []
  );

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    swActive,
    notificationPermission,
    installApp,
    requestPushPermission,
    triggerTestNotification,
  };
}
