import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import * as XLSX from 'xlsx';
import { parseLocalDate } from './scheduler';
import { translations } from './translations';
import { Family, Shift, ShiftType } from './types';

export interface ExportScheduleOptions {
  termName: string;
  startDate: string;
  endDate: string;
  shifts: Shift[];
  shiftTypes: ShiftType[];
  families: Family[];
  filterFamilyId?: string | null;
  appName?: string;
  lang?: 'sv' | 'en';
}

/**
 * Calculates ISO 8601 week number (standard in Sweden and Europe)
 */
export function getIsoWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

/**
 * Exports the schedule as a beautifully styled Microsoft Word (.docx) document
 */
export async function exportToWordDocx(options: ExportScheduleOptions): Promise<void> {
  const {
    termName,
    startDate,
    endDate,
    shifts,
    shiftTypes,
    families,
    filterFamilyId,
    appName = 'Axets föräldratjänst',
    lang = 'sv',
  } = options;

  const t = translations[lang] || translations.sv;
  const familyMap = new Map(families.map(f => [f.id, f]));
  const typeMap = new Map(shiftTypes.map(st => [st.id, st]));

  const filteredFamily = filterFamilyId ? familyMap.get(filterFamilyId) : null;

  // Filter and sort shifts chronologically
  const activeShifts = shifts
    .filter(s => !s.isCancelled)
    .filter(s => !filterFamilyId || s.assignedFamilyId === filterFamilyId)
    .sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: 'E2E8F0',
  };

  const headerBorderStyle = {
    style: BorderStyle.SINGLE,
    size: 6,
    color: '0D5E57',
  };

  const cellBorders = {
    top: borderStyle,
    bottom: borderStyle,
    left: borderStyle,
    right: borderStyle,
  };

  const headerBorders = {
    top: headerBorderStyle,
    bottom: headerBorderStyle,
    left: headerBorderStyle,
    right: headerBorderStyle,
  };

  const cellMargins = {
    top: 100,
    bottom: 100,
    left: 120,
    right: 120,
  };

  // Header row for main schedule table
  const tableHeaderRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      new TableCell({
        width: { size: 800, type: WidthType.DXA },
        shading: { fill: '0F766E', type: ShadingType.CLEAR },
        borders: headerBorders,
        margins: cellMargins,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: lang === 'sv' ? 'Vecka' : 'Week', bold: true, color: 'FFFFFF', size: 18 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 2100, type: WidthType.DXA },
        shading: { fill: '0F766E', type: ShadingType.CLEAR },
        borders: headerBorders,
        margins: cellMargins,
        children: [
          new Paragraph({
            children: [new TextRun({ text: lang === 'sv' ? 'Datum & Dag' : 'Date & Day', bold: true, color: 'FFFFFF', size: 18 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 1700, type: WidthType.DXA },
        shading: { fill: '0F766E', type: ShadingType.CLEAR },
        borders: headerBorders,
        margins: cellMargins,
        children: [
          new Paragraph({
            children: [new TextRun({ text: lang === 'sv' ? 'Tid' : 'Time', bold: true, color: 'FFFFFF', size: 18 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 1900, type: WidthType.DXA },
        shading: { fill: '0F766E', type: ShadingType.CLEAR },
        borders: headerBorders,
        margins: cellMargins,
        children: [
          new Paragraph({
            children: [new TextRun({ text: lang === 'sv' ? 'Passtyp' : 'Shift Type', bold: true, color: 'FFFFFF', size: 18 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 2100, type: WidthType.DXA },
        shading: { fill: '0F766E', type: ShadingType.CLEAR },
        borders: headerBorders,
        margins: cellMargins,
        children: [
          new Paragraph({
            children: [new TextRun({ text: lang === 'sv' ? 'Tilldelad familj' : 'Assigned Family', bold: true, color: 'FFFFFF', size: 18 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 1000, type: WidthType.DXA },
        shading: { fill: '0F766E', type: ShadingType.CLEAR },
        borders: headerBorders,
        margins: cellMargins,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: lang === 'sv' ? 'Utfört' : 'Done', bold: true, color: 'FFFFFF', size: 18 })],
          }),
        ],
      }),
    ],
  });

  // Data rows
  const scheduleRows: TableRow[] = [tableHeaderRow];

  activeShifts.forEach((shift, index) => {
    const isEven = index % 2 === 0;
    const bgFill = isEven ? 'FFFFFF' : 'F8FAFC';
    const sType = typeMap.get(shift.shiftTypeId);
    const family = shift.assignedFamilyId ? familyMap.get(shift.assignedFamilyId) : null;
    const dateObj = parseLocalDate(shift.date);
    const weekdayName = t.weekdays[dateObj.getDay()] || '';
    const monthShort = t.monthsShort[dateObj.getMonth()] || '';
    const dateFormatted = `${weekdayName} ${dateObj.getDate()} ${monthShort}`;
    const isoWeek = getIsoWeek(shift.date);
    const timeFormatted = `${shift.startTime || '—'} – ${shift.endTime || '—'}`;
    const familyName = family ? family.name : (lang === 'sv' ? 'Ej tilldelad' : 'Unassigned');

    scheduleRows.push(
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 800, type: WidthType.DXA },
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            borders: cellBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `v. ${isoWeek}`, bold: true, size: 18, color: '374151' })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 2100, type: WidthType.DXA },
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            borders: cellBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: dateFormatted, bold: true, size: 18, color: '111827' }),
                  new TextRun({ text: ` (${shift.date})`, size: 15, color: '6B7280' }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 1700, type: WidthType.DXA },
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            borders: cellBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                children: [new TextRun({ text: timeFormatted, size: 18, color: '374151' })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 1900, type: WidthType.DXA },
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            borders: cellBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                children: [new TextRun({ text: sType?.name || shift.name, bold: true, size: 18, color: '0F766E' })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 2100, type: WidthType.DXA },
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            borders: cellBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: familyName,
                    bold: Boolean(family),
                    size: 18,
                    color: family ? '111827' : 'DC2626',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 1000, type: WidthType.DXA },
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            borders: cellBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: '[   ]', size: 18, color: '9CA3AF' })],
              }),
            ],
          }),
        ],
      })
    );
  });

  // Family Summary Section (if exporting full schedule)
  const familySummaryChildren: (Paragraph | Table)[] = [];
  if (!filterFamilyId && families.length > 0) {
    familySummaryChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 140 },
        children: [
          new TextRun({
            text: lang === 'sv' ? 'Sammanställning per familj' : 'Family Summary',
            bold: true,
            size: 24,
            color: '0F766E',
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 160 },
        children: [
          new TextRun({
            text:
              lang === 'sv'
                ? 'Översikt över varje familjs tilldelade pass under terminen:'
                : 'Overview of shifts assigned to each family during the term:',
            size: 18,
            color: '4B5563',
          }),
        ],
      })
    );

    const familySummaryRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 2600, type: WidthType.DXA },
            shading: { fill: '0F766E', type: ShadingType.CLEAR },
            borders: headerBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                children: [new TextRun({ text: lang === 'sv' ? 'Familj' : 'Family', bold: true, color: 'FFFFFF', size: 18 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 1400, type: WidthType.DXA },
            shading: { fill: '0F766E', type: ShadingType.CLEAR },
            borders: headerBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: lang === 'sv' ? 'Antal pass' : 'Total shifts', bold: true, color: 'FFFFFF', size: 18 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 5600, type: WidthType.DXA },
            shading: { fill: '0F766E', type: ShadingType.CLEAR },
            borders: headerBorders,
            margins: cellMargins,
            children: [
              new Paragraph({
                children: [new TextRun({ text: lang === 'sv' ? 'Datum och pass' : 'Assigned Dates & Shifts', bold: true, color: 'FFFFFF', size: 18 })],
              }),
            ],
          }),
        ],
      }),
    ];

    [...families]
      .sort((a, b) => a.name.localeCompare(b.name, lang))
      .forEach((fam, fIndex) => {
        const famShifts = activeShifts.filter(s => s.assignedFamilyId === fam.id);
        const shiftListText =
          famShifts.length > 0
            ? famShifts
                .map(s => {
                  const st = typeMap.get(s.shiftTypeId);
                  const d = parseLocalDate(s.date);
                  return `${d.getDate()} ${t.monthsShort[d.getMonth()]} (${st?.name || s.name})`;
                })
                .join(', ')
            : lang === 'sv'
            ? 'Inga pass tilldelade'
            : 'No shifts assigned';

        const isEven = fIndex % 2 === 0;
        const bgFill = isEven ? 'FFFFFF' : 'F8FAFC';

        familySummaryRows.push(
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                width: { size: 2600, type: WidthType.DXA },
                shading: { fill: bgFill, type: ShadingType.CLEAR },
                borders: cellBorders,
                margins: cellMargins,
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: fam.name, bold: true, size: 18, color: '111827' })],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 1400, type: WidthType.DXA },
                shading: { fill: bgFill, type: ShadingType.CLEAR },
                borders: cellBorders,
                margins: cellMargins,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: `${famShifts.length} st`, bold: true, size: 18, color: '0F766E' })],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 5600, type: WidthType.DXA },
                shading: { fill: bgFill, type: ShadingType.CLEAR },
                borders: cellBorders,
                margins: cellMargins,
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: shiftListText, size: 16, color: '374151' })],
                  }),
                ],
              }),
            ],
          })
        );
      });

    familySummaryChildren.push(
      new Table({
        width: { size: 9600, type: WidthType.DXA },
        alignment: AlignmentType.CENTER,
        rows: familySummaryRows,
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.PORTRAIT,
            },
            margin: {
              top: 1153,
              right: 1153,
              bottom: 1153,
              left: 1153,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${appName} • ${termName} • `,
                    size: 16,
                    color: '9CA3AF',
                  }),
                  new TextRun({ text: lang === 'sv' ? 'Sida ' : 'Page ', size: 16, color: '9CA3AF' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '9CA3AF' }),
                  new TextRun({ text: lang === 'sv' ? ' av ' : ' of ', size: 16, color: '9CA3AF' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '9CA3AF' }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Header / Title block
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.LEFT,
            spacing: { after: 60 },
            children: [
              new TextRun({
                text: appName,
                bold: true,
                size: 32,
                color: '0F766E',
              }),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.LEFT,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: filteredFamily
                  ? `${termName} — Arbetsschema för ${filteredFamily.name}`
                  : `${termName} — Föräldraschema & Städning`,
                bold: true,
                size: 26,
                color: '111827',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: `${lang === 'sv' ? 'Terminsperiod' : 'Period'}: ${startDate} till ${endDate}  •  ${lang === 'sv' ? 'Totalt antal pass' : 'Total shifts'}: ${activeShifts.length} st  •  ${lang === 'sv' ? 'Antal familjer' : 'Families'}: ${families.length} st`,
                size: 18,
                color: '4B5563',
              }),
            ],
          }),

          // Main Table
          new Table({
            width: { size: 9600, type: WidthType.DXA },
            alignment: AlignmentType.CENTER,
            rows: scheduleRows,
          }),

          // Family Summary Section (appended if full schedule)
          ...familySummaryChildren,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const cleanTermName = termName.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_');
  const filename = filteredFamily
    ? `${cleanTermName}_schema_${filteredFamily.name.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_')}.docx`
    : `${cleanTermName}_schema_fullstandigt.docx`;

  triggerBlobDownload(blob, filename);
}

/**
 * Exports the schedule as a genuine Microsoft Excel workbook (.xlsx)
 * with native UTF-8 OpenXML encoding, fully supporting å, ä, ö and all international characters.
 */
export function exportToExcel(options: ExportScheduleOptions): void {
  const {
    termName,
    shifts,
    shiftTypes,
    families,
    filterFamilyId,
    lang = 'sv',
  } = options;

  const t = translations[lang] || translations.sv;
  const familyMap = new Map(families.map(f => [f.id, f]));
  const typeMap = new Map(shiftTypes.map(st => [st.id, st]));
  const filteredFamily = filterFamilyId ? familyMap.get(filterFamilyId) : null;

  const activeShifts = shifts
    .filter(s => !s.isCancelled)
    .filter(s => !filterFamilyId || s.assignedFamilyId === filterFamilyId)
    .sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

  const wb = XLSX.utils.book_new();

  // Sheet 1: Schedule
  const headers = [
    lang === 'sv' ? 'Vecka' : 'Week',
    lang === 'sv' ? 'Datum' : 'Date',
    lang === 'sv' ? 'Veckodag' : 'Day',
    lang === 'sv' ? 'Starttid' : 'Start time',
    lang === 'sv' ? 'Sluttid' : 'End time',
    lang === 'sv' ? 'Passtyp' : 'Shift type',
    lang === 'sv' ? 'Tilldelad familj' : 'Assigned family',
    lang === 'sv' ? 'Poäng' : 'Points',
    lang === 'sv' ? 'Anteckning' : 'Notes',
  ];

  const dataRows = activeShifts.map(s => {
    const sType = typeMap.get(s.shiftTypeId);
    const fam = s.assignedFamilyId ? familyMap.get(s.assignedFamilyId) : null;
    const dateObj = parseLocalDate(s.date);
    const weekday = t.weekdays[dateObj.getDay()] || '';
    const isoWeek = getIsoWeek(s.date);

    return [
      `v. ${isoWeek}`,
      s.date,
      weekday,
      s.startTime || '',
      s.endTime || '',
      sType?.name || s.name,
      fam ? fam.name : (lang === 'sv' ? 'Ej tilldelad' : 'Unassigned'),
      sType?.weight ?? 1.0,
      s.notes || '',
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

  // Set column widths in Excel
  ws['!cols'] = [
    { wch: 8 },  // Vecka
    { wch: 12 }, // Datum
    { wch: 12 }, // Veckodag
    { wch: 10 }, // Starttid
    { wch: 10 }, // Sluttid
    { wch: 22 }, // Passtyp
    { wch: 25 }, // Tilldelad familj
    { wch: 8 },  // Poäng
    { wch: 25 }, // Anteckning
  ];

  XLSX.utils.book_append_sheet(
    wb,
    ws,
    lang === 'sv' ? 'Arbetsschema' : 'Schedule'
  );

  // If exporting the full schedule without family filter, also add a Summary sheet per family
  if (!filteredFamily && families.length > 0) {
    const summaryHeaders = [
      lang === 'sv' ? 'Familj' : 'Family',
      lang === 'sv' ? 'Antal pass' : 'Total shifts',
      lang === 'sv' ? 'Datum och pass' : 'Assigned dates & shifts',
    ];

    const summaryRows = [...families]
      .sort((a, b) => a.name.localeCompare(b.name, lang))
      .map(fam => {
        const famShifts = activeShifts.filter(s => s.assignedFamilyId === fam.id);
        const shiftListText =
          famShifts.length > 0
            ? famShifts
                .map(s => {
                  const st = typeMap.get(s.shiftTypeId);
                  const d = parseLocalDate(s.date);
                  return `${d.getDate()} ${t.monthsShort[d.getMonth()]} (${st?.name || s.name})`;
                })
                .join(', ')
            : lang === 'sv'
            ? 'Inga pass tilldelade'
            : 'No shifts assigned';

        return [fam.name, famShifts.length, shiftListText];
      });

    const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
    summaryWs['!cols'] = [
      { wch: 25 },
      { wch: 12 },
      { wch: 55 },
    ];

    XLSX.utils.book_append_sheet(
      wb,
      summaryWs,
      lang === 'sv' ? 'Sammanfattning' : 'Summary'
    );
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const cleanTermName = termName.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_');
  const filename = filteredFamily
    ? `${cleanTermName}_schema_${filteredFamily.name.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_')}.xlsx`
    : `${cleanTermName}_schema.xlsx`;

  triggerBlobDownload(blob, filename);
}

/**
 * Exports the schedule as a UTF-8 BOM CSV (Excel compatible with Swedish locale)
 */
export function exportToCsv(options: ExportScheduleOptions): void {
  const {
    termName,
    shifts,
    shiftTypes,
    families,
    filterFamilyId,
    lang = 'sv',
  } = options;

  const t = translations[lang] || translations.sv;
  const familyMap = new Map(families.map(f => [f.id, f]));
  const typeMap = new Map(shiftTypes.map(st => [st.id, st]));

  const filteredFamily = filterFamilyId ? familyMap.get(filterFamilyId) : null;

  const activeShifts = shifts
    .filter(s => !s.isCancelled)
    .filter(s => !filterFamilyId || s.assignedFamilyId === filterFamilyId)
    .sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

  // Header row (using semicolon delimiter standard for Swedish Excel)
  const headers = [
    lang === 'sv' ? 'Vecka' : 'Week',
    lang === 'sv' ? 'Datum' : 'Date',
    lang === 'sv' ? 'Veckodag' : 'Day',
    lang === 'sv' ? 'Starttid' : 'Start time',
    lang === 'sv' ? 'Sluttid' : 'End time',
    lang === 'sv' ? 'Passtyp' : 'Shift type',
    lang === 'sv' ? 'Tilldelad familj' : 'Assigned family',
    lang === 'sv' ? 'Poängvärde' : 'Point weight',
    lang === 'sv' ? 'Anteckning' : 'Notes',
  ];

  const rows = activeShifts.map(s => {
    const sType = typeMap.get(s.shiftTypeId);
    const fam = s.assignedFamilyId ? familyMap.get(s.assignedFamilyId) : null;
    const dateObj = parseLocalDate(s.date);
    const weekday = t.weekdays[dateObj.getDay()] || '';
    const isoWeek = getIsoWeek(s.date);

    return [
      `v. ${isoWeek}`,
      s.date,
      weekday,
      s.startTime || '',
      s.endTime || '',
      sType?.name || s.name,
      fam ? fam.name : (lang === 'sv' ? 'Ej tilldelad' : 'Unassigned'),
      String(sType?.weight ?? 1.0),
      s.notes || '',
    ].map(escapeCsvField);
  });

  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const csvBody = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
  const blob = new Blob([bom, csvBody], { type: 'text/csv;charset=utf-8' });

  const cleanTermName = termName.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_');
  const filename = filteredFamily
    ? `${cleanTermName}_${filteredFamily.name.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_')}.csv`
    : `${cleanTermName}_schema.csv`;

  triggerBlobDownload(blob, filename);
}

function escapeCsvField(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Triggers native browser print preview (which also enables "Save as PDF")
 */
export function triggerPrintSchedule(): void {
  if (typeof window !== 'undefined') {
    window.print();
  }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
