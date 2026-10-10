import { notifyError, request } from './api.js';
import { toast } from './utils.js';

const PDF_LIBRARY_URLS = [
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js'
];

const loadPdfLibrary = async () => {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  for (const src of PDF_LIBRARY_URLS) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('Could not load the PDF generator.')); };
        document.head.append(script);
      });
      if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    } catch { /* Try the backup CDN before reporting a clear error. */ }
  }
  throw new Error('The certificate PDF tool could not load. Check your internet connection and try again.');
};

export const downloadCertificate = async (donationId) => {
  try {
    toast('Preparing your official donation certificate…');
    const response = await request(`/api/certificate/${encodeURIComponent(donationId)}`);
    const c = response.certificate;
    if (!c?.donationDetails) throw new Error('Certificate details are incomplete. Please try again later.');

    const jsPDF = await loadPdfLibrary();
    // Create landscape certificate
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Background gradient / border
    doc.setFillColor(253, 252, 248);
    doc.rect(0, 0, 297, 210, 'F');

    // Outer and Inner Borders
    doc.setDrawColor(29, 102, 56); // Deep Green
    doc.setLineWidth(3);
    doc.rect(10, 10, 277, 190);

    doc.setDrawColor(200, 160, 80); // Gold accent
    doc.setLineWidth(0.8);
    doc.rect(14, 14, 269, 182);

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(29, 102, 56);
    doc.text('FOOD RESCUE & ZERO-WASTE IMPACT CERTIFICATE', 148.5, 34, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(110, 120, 110);
    doc.text(`Official Verification ID: ${c.certificateNumber}  •  Issued on: ${c.issueDate}`, 148.5, 43, { align: 'center' });

    // Ribbon statement
    doc.setFont('times', 'italic');
    doc.setFontSize(14);
    doc.setTextColor(50, 60, 50);
    doc.text('This verified certification is proudly presented to', 148.5, 58, { align: 'center' });

    // Business Name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(23, 37, 25);
    doc.text(String(c.donor?.name || 'Valued Food Donor').toUpperCase(), 148.5, 71, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90, 100, 90);
    doc.text(`${c.donor.city || ''}`, 148.5, 78, { align: 'center' });

    // Body
    doc.setFont('times', 'normal');
    doc.setFontSize(13);
    doc.setTextColor(40, 50, 40);
    doc.text(
      `In recognition of exceptional social responsibility and hunger relief dedication by donating surplus fresh food,\npreventing environmental degradation, and feeding vulnerable individuals through certified partner organizations.`,
      148.5, 92, { align: 'center' }
    );

    // Impact Metrics Box
    doc.setFillColor(240, 248, 240);
    doc.roundedRect(55, 108, 187, 36, 4, 4, 'F');
    doc.setDrawColor(180, 220, 180);
    doc.roundedRect(55, 108, 187, 36, 4, 4, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(29, 102, 56);
    doc.text(`${c.donationDetails.mealsRescued}`, 148.5, 122, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(70, 85, 70);
    doc.text('VERIFIED MEALS RESCUED', 148.5, 131, { align: 'center' });

    // Partner Details
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20, 30, 20);
    doc.text(`Beneficiary Distribution Partner:`, 30, 160);
    doc.setFont('helvetica', 'normal');
    doc.text(`${c.receivingNgo?.name || 'Verified Partner NGO'} (${c.receivingNgo?.city || ''})`, 95, 160);

    doc.setFont('helvetica', 'bold');
    doc.text(`Food Item & Lot:`, 30, 167);
    doc.setFont('helvetica', 'normal');
    doc.text(`${c.donationDetails.foodName || 'Food donation'} (${c.donationDetails.quantity || 'Quantity not recorded'})`, 65, 167);

    // Signatures
    doc.setDrawColor(160, 160, 160);
    doc.line(30, 185, 95, 185);
    doc.line(200, 185, 265, 185);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Authorized Audit Verification', 62.5, 190, { align: 'center' });
    doc.text('National Food Rescue Coordinator', 232.5, 190, { align: 'center' });

    // Official Seal badge
    doc.setFillColor(29, 102, 56);
    doc.circle(148.5, 175, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text('CERTIFIED', 148.5, 174, { align: 'center' });
    doc.text('ZERO WASTE', 148.5, 178, { align: 'center' });

    // Save PDF
    doc.save(`Food-Rescue-Certificate-${c.donationDetails.id}.pdf`);
    toast('Certificate downloaded successfully!');
  } catch (error) {
    notifyError(error);
  }
};
