import { initAuth, protectRoute } from './auth.js';
import { initAdminIntegration } from './admin.js';
import { initContactIntegration } from './contact.js';
import { initBusinessDashboard, initNgoDashboard, initAdminDashboard } from './dashboard.js';
import { initDonationIntegration } from './donation.js';
import { initNgoIntegration } from './ngo.js';
import { initProfileIntegration } from './profile.js';
import {
  initCharts,
  initDonationFilters,
  initNotifications,
  initPdfReports,
  initTheme,
  initEmergencyBanner,
  initLiveOperationsMap,
  initPublicImpactCounters,
  initExpiryCountdowns
} from './features.js';
import { initFreshnessPredictor } from './freshness.js';
import { initDonationChat } from './chat.js';

const boot = async () => {
  if (!protectRoute()) return;
  initTheme();
  initAuth();
  initDonationIntegration();
  initNgoIntegration();
  initAdminIntegration();
  initContactIntegration();
  initDonationFilters();
  initPdfReports();
  initFreshnessPredictor();
  initDonationChat();
  initExpiryCountdowns();
  initEmergencyBanner();

  const dashboard = document.body.dataset.dashboard;
  const tasks = [
    initProfileIntegration(),
    initCharts(),
    initLiveOperationsMap(),
    initPublicImpactCounters()
  ];
  if (dashboard === 'business') tasks.push(initBusinessDashboard());
  if (dashboard === 'ngo') tasks.push(initNgoDashboard());
  if (dashboard === 'admin') tasks.push(initAdminDashboard());
  if (document.querySelector('[data-notification-bell]')) tasks.push(initNotifications());

  await Promise.allSettled(tasks);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
