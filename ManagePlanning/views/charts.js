// views/charts.js

import { db, showViewLoader, setViewStatus } from '../script.js';

const HIGH_THRESHOLD_HOURS = 35;
const LOW_THRESHOLD_HOURS = 35; 

let activeChartInstances = []; 

const chartColors = {
    danger: 'rgba(191, 97, 106, 0.75)',   // Rouge Nordique (Semaines Hautes)
    secondary: 'rgba(136, 192, 208, 0.75)',// Bleu Nordique Clair (Semaines Basses)
    accent: 'rgba(235, 203, 139, 0.75)',  // Jaune Moutarde Nordique
    purpleSoft: 'rgba(180, 142, 173, 0.75)', // Violet Nordique doux
    
    pieColorsArray: [ 
        'rgba(191, 97, 106, 0.85)',   // Hautes (danger)
        'rgba(136, 192, 208, 0.85)',  // Basses (secondary)
        'rgba(163, 190, 140, 0.85)',  // Vert Nordique (pour "Autres" ou "Normales")
        'rgba(94, 129, 172, 0.85)',   // Bleu Nordique Froid (primary)
        'rgba(235, 203, 139, 0.85)',  // Jaune (accent)
        'rgba(129, 161, 193, 0.85)'   // Bleu-Gris (info)
    ]
};

function getCssVariableValue(variableName, fallback = '#000000') {
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.documentElement) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
        return value || fallback;
    }
    return fallback; 
}

function showPdfSpinner() {
    const spinnerOverlay = document.getElementById('pdfSpinnerOverlay');
    if (spinnerOverlay) spinnerOverlay.style.display = 'flex';
}

function hidePdfSpinner() {
    const spinnerOverlay = document.getElementById('pdfSpinnerOverlay');
    if (spinnerOverlay) spinnerOverlay.style.display = 'none';
}

export function initChartsView() {
    console.log("Initialisation de la vue Charts");
    const refreshButton = document.getElementById('refreshButtonChart');
    const exportPdfButton = document.getElementById('exportChartsToPdfButton');

    if (refreshButton) refreshButton.addEventListener('click', loadAndProcessData_ChartsView);
    if (exportPdfButton) exportPdfButton.addEventListener('click', exportChartsViewToPdfWithJsPDF);
    
    if (typeof Chart === 'undefined') { setViewStatus("Chart.js n'est pas chargé.", "error"); return; }
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
        console.warn("jsPDF/html2canvas non chargé. Export PDF désactivé.");
        if(exportPdfButton) exportPdfButton.disabled = true;
    } else {
        if(exportPdfButton) exportPdfButton.disabled = false; // Réactiver si les libs sont là
    }
    loadAndProcessData_ChartsView();
}

export function cleanupChartsView() {
    activeChartInstances.forEach(chart => {
        try { chart.destroy(); } catch(e) { console.warn("Erreur lors de la destruction d'un graphique:", e); }
    });
    activeChartInstances = [];
    console.log("Instances de graphiques nettoyées.");
}

async function exportChartsViewToPdfWithJsPDF() {
    const exportButton = document.getElementById('exportChartsToPdfButton');
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
        alert("Les librairies PDF (jsPDF ou html2canvas) ne sont pas chargées."); return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    setViewStatus("Génération du PDF...", "info");
    if (exportButton) exportButton.disabled = true;
    showPdfSpinner();
    const originalChartDefaultsAnimation = Chart.defaults.animation;
    Chart.defaults.animation = false; 
    const PAGE_MARGIN = 15; let currentY = PAGE_MARGIN;
    const pageWidth = doc.internal.pageSize.getWidth(); const usableWidth = pageWidth - (2 * PAGE_MARGIN);
    let pageJustAdded = false;
    function checkAndAddPage(neededHeight = 20) {
        if (currentY + neededHeight > doc.internal.pageSize.getHeight() - PAGE_MARGIN) {
            doc.addPage(); currentY = PAGE_MARGIN; pageJustAdded = true; return true;
        } pageJustAdded = false; return false;
    }
    try {
        doc.setFontSize(16); // Titre un peu plus petit pour PDF
        doc.setFont("helvetica", "bold");
        const mainTitleText = document.querySelector('#charts-exportable-content > h1')?.textContent || "Analyse Détaillée des Heures";
        const mainTitleLines = doc.splitTextToSize(mainTitleText, usableWidth);
        doc.text(mainTitleLines, pageWidth / 2, currentY, { align: 'center' });
        currentY += (mainTitleLines.length * 6) + 10; // Ajustement de la hauteur de ligne du titre

        // Exporter d'abord le tableau récapitulatif
        const summaryTableElement = document.getElementById('summaryAnnualHoursTable');
        if (summaryTableElement) {
            if (!pageJustAdded) checkAndAddPage(15); else currentY = PAGE_MARGIN; 
            pageJustAdded = false;

            const summaryTitleElement = document.querySelector('.summary-table-title');
            if (summaryTitleElement) {
                doc.setFontSize(12); doc.setFont("helvetica", "bold");
                doc.text(summaryTitleElement.textContent, PAGE_MARGIN, currentY); currentY += 8;
            }
            await new Promise(resolve => setTimeout(resolve, 100)); // Attendre le rendu du tableau
             // Utiliser autoTable pour un meilleur rendu des tableaux
            if (typeof doc.autoTable === 'function') {
                doc.autoTable({
                    html: '#summaryAnnualHoursTable',
                    startY: currentY,
                    theme: 'grid',
                    headStyles: { fillColor: [94, 129, 172] }, // --primary-color
                    styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
                    didDrawPage: function (data) { currentY = data.cursor.y + 5; pageJustAdded = true; }, // Mettre à jour Y
                    // Éviter de redessiner les titres principaux sur chaque page du tableau
                    showHead: 'firstPage' 
                });
                 currentY = doc.autoTable.previous.finalY + 10; // S'assurer que Y est après le tableau
            } else { // Fallback si autoTable n'est pas là (vous devriez l'inclure)
                console.warn("jspdf-autotable non chargé. Rendu du tableau basique.");
                // Logique de rendu de tableau basique ou capture html2canvas pour le tableau
                doc.text("Tableau récapitulatif (jspdf-autotable manquant)", PAGE_MARGIN, currentY); currentY +=10;
            }
        }


        const annualGroups = document.querySelectorAll('#charts-annual-summary-container .annual-chart-group');
        for (const group of annualGroups) {
            if (!pageJustAdded) checkAndAddPage(20); else currentY = PAGE_MARGIN;
            pageJustAdded = false;
            const yearTitleElement = group.querySelector('.year-title');
            if (yearTitleElement) {
                doc.setFontSize(14); doc.setFont("helvetica", "bold");
                doc.text(yearTitleElement.textContent.replace("Graphiques Détaillés - ", ""), PAGE_MARGIN, currentY); currentY += 8; // Enlever la redondance
            }
            const chartCards = group.querySelectorAll('.chart-card');
            for (const card of chartCards) {
                if (!pageJustAdded) checkAndAddPage(15); else currentY = Math.max(currentY, PAGE_MARGIN);
                 pageJustAdded = false;
                const sectionTitleElement = card.querySelector('.chart-section-title');
                if (sectionTitleElement) {
                    doc.setFontSize(10); doc.setFont("helvetica", "bolditalic");
                    doc.text(sectionTitleElement.textContent, PAGE_MARGIN, currentY); currentY += 5;
                }
                const keyMetricElement = card.querySelector('.chart-key-metric');
                 if (keyMetricElement) {
                    doc.setFontSize(8); doc.setFont("helvetica", "italic");
                    doc.text(keyMetricElement.textContent, PAGE_MARGIN, currentY); currentY += 4;
                }
                const canvasElement = card.querySelector('canvas');
                if (canvasElement) {
                    await new Promise(resolve => setTimeout(resolve, 300)); // Délai un peu plus long pour html2canvas
                    try {
                        const canvasImg = await html2canvas(canvasElement, { scale: 2, backgroundColor: '#FFFFFF', logging: false, useCORS: true });
                        const imgData = canvasImg.toDataURL('image/png'); const imgProps = doc.getImageProperties(imgData);
                        let imgHeight = (imgProps.height * (usableWidth * 0.9)) / imgProps.width; // *0.9 pour laisser de la marge
                        let imgWidth = usableWidth * 0.9;
                        const availableHeight = doc.internal.pageSize.getHeight() - currentY - PAGE_MARGIN;
                        if (imgHeight > availableHeight) {
                            if (availableHeight < 30) { checkAndAddPage(imgHeight); imgHeight = Math.min(imgHeight, doc.internal.pageSize.getHeight() - 2 * PAGE_MARGIN - 10); } 
                            else { imgHeight = availableHeight -5 ; } // -5 pour petite marge
                            imgWidth = (imgProps.width * imgHeight) / imgProps.height;
                        }
                        if (!pageJustAdded) checkAndAddPage(imgHeight + 5); else currentY = Math.max(currentY, PAGE_MARGIN);
                         pageJustAdded = false;
                        
                        const imgX = (pageWidth - imgWidth) / 2;
                        doc.addImage(imgData, 'PNG', imgX, currentY, imgWidth, imgHeight); currentY += imgHeight + 6;
                    } catch(e) {
                        console.error("Erreur capture canvas:", canvasElement.id, e);
                        if(!pageJustAdded) checkAndAddPage(7); else currentY = Math.max(currentY, PAGE_MARGIN); pageJustAdded=false;
                        doc.setTextColor(191, 97, 106); doc.text("Erreur capture du graphique.", PAGE_MARGIN, currentY);
                        doc.setTextColor(46, 52, 64); currentY += 7;
                    }
                }
            }
            currentY += 6; 
        }
        doc.save('analyse_graphiques_heures.pdf'); setViewStatus("PDF généré.", "success");
    } catch (error) { console.error("Erreur PDF jsPDF:", error); setViewStatus("Erreur génération PDF.", "error");
    } finally { Chart.defaults.animation = originalChartDefaultsAnimation; if (exportButton) exportButton.disabled = false; hidePdfSpinner(); }
}

async function loadAndProcessData_ChartsView() {
    if (!db) { setViewStatus("Firebase non initialisé.", "error"); return; }
    if (typeof Chart === 'undefined') { setViewStatus("Chart.js non chargé.", "error"); return; }
    showViewLoader(true); setViewStatus('Chargement des données...'); cleanupChartsView(); 
    const chartsAnnualContainer = document.getElementById('charts-annual-summary-container');
    const summaryTableContainer = document.getElementById('chartsSummaryTableContainer');

    if (!chartsAnnualContainer || !summaryTableContainer) { console.error("Conteneurs non trouvés."); showViewLoader(false); return; }
    chartsAnnualContainer.innerHTML = ''; summaryTableContainer.innerHTML = '';

    try {
        const querySnapshot = await db.collection("heuresTravail").orderBy("personne").orderBy("semaine", "asc").get();
        if (querySnapshot.empty) { setViewStatus('Aucune donnée Firebase.'); showViewLoader(false); return; }
        
        console.log(`[CHARTS INFO] Nombre total de documents lus depuis Firestore: ${querySnapshot.size}`);
        const annualData = {}; const personWeeklyData = {};
        let davidVerdin2025DataCount = 0; // Compteur pour le log

        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.personne || typeof data.heures !== 'number' || !data.semaine) {
                console.warn("[FILTERED OUT PRE-PROCESS] Ignoré (champ manquant):", data); return;
            }
            const year = data.semaine.substring(0, 4); 
            const hours = parseFloat(data.heures); 
            if (isNaN(hours)) {
                console.warn("[FILTERED OUT PRE-PROCESS] Ignoré (heures NaN):", data.semaine, data.heures, data); return;
            }

            if (year === "2025" && data.personne === "David VERDIN") {
                davidVerdin2025DataCount++;
                 console.log(`[INSPECT DV2025 #${davidVerdin2025DataCount}] Sem: ${data.semaine}, H: ${hours}`);
            }

            if (!annualData[year]) annualData[year] = {};
            if (!annualData[year][data.personne]) {
                annualData[year][data.personne] = { high: 0, low: 0, totalActiveWeeks: 0, weeklyHours: {}, maxConsecutiveHigh: 0, maxConsecutiveLow: 0 };
            }
            if (!personWeeklyData[data.personne]) personWeeklyData[data.personne] = {};
            annualData[year][data.personne].totalActiveWeeks++;
            annualData[year][data.personne].weeklyHours[data.semaine] = hours;
            
            let countedForBarChart = false; 
            if (hours > HIGH_THRESHOLD_HOURS) { 
                annualData[year][data.personne].high++; countedForBarChart = true;
            } else if (hours > 0 && hours <= LOW_THRESHOLD_HOURS) { 
                annualData[year][data.personne].low++; countedForBarChart = true;
            }
            if (!countedForBarChart && year === "2025" && data.personne === "David VERDIN" && hours > 0) { // Log seulement si heures > 0 et non compté
                console.log("[DEBUG CHARTS] Sem. NON COMPTÉE (barres) pour David VERDIN 2025 (H>0):", data.semaine, "Heures:", hours);
            } else if (!countedForBarChart && year === "2025" && data.personne === "David VERDIN" && hours === 0) {
                 console.log("[DEBUG CHARTS] Sem. NON COMPTÉE (barres) pour David VERDIN 2025 (H=0):", data.semaine, "Heures:", hours);
            }
            personWeeklyData[data.personne][data.semaine] = hours;
        });
        console.log(`[CHARTS INFO] David VERDIN 2025: ${davidVerdin2025DataCount} semaines traitées dans la boucle initiale.`);

        if (annualData["2025"] && annualData["2025"]["David VERDIN"]) {
            console.log("[AGGREGATE CHECK 2025] David VERDIN - Hautes:", annualData["2025"]["David VERDIN"].high);
            console.log("[AGGREGATE CHECK 2025] David VERDIN - Basses:", annualData["2025"]["David VERDIN"].low);
            console.log("[AGGREGATE CHECK 2025] David VERDIN - Total Actives:", annualData["2025"]["David VERDIN"].totalActiveWeeks);
        } else { console.log("[AGGREGATE CHECK 2025] Pas de données pour David VERDIN 2025 après boucle principale."); }

        for (const person in personWeeklyData) {
            const weeksForPerson = Object.keys(personWeeklyData[person]).sort();
            let currentConsecutiveHigh = 0, currentConsecutiveLow = 0, lastYearProcessed = "";
            for (const week of weeksForPerson) {
                const year = week.substring(0, 4); const hours = personWeeklyData[person][week];
                if (year !== lastYearProcessed && lastYearProcessed !== "") {
                    if (annualData[lastYearProcessed]?.[person]) {
                        annualData[lastYearProcessed][person].maxConsecutiveHigh = Math.max(annualData[lastYearProcessed][person].maxConsecutiveHigh, currentConsecutiveHigh);
                        annualData[lastYearProcessed][person].maxConsecutiveLow = Math.max(annualData[lastYearProcessed][person].maxConsecutiveLow, currentConsecutiveLow);
                    }
                    currentConsecutiveHigh = 0; currentConsecutiveLow = 0;
                }
                lastYearProcessed = year;
                if (hours > HIGH_THRESHOLD_HOURS) { currentConsecutiveHigh++; currentConsecutiveLow = 0; } 
                else if (hours > 0 && hours <= LOW_THRESHOLD_HOURS) { currentConsecutiveLow++; currentConsecutiveHigh = 0; } 
                else { currentConsecutiveHigh = 0; currentConsecutiveLow = 0; }
                if (annualData[year]?.[person]) {
                    annualData[year][person].maxConsecutiveHigh = Math.max(annualData[year][person].maxConsecutiveHigh, currentConsecutiveHigh);
                    annualData[year][person].maxConsecutiveLow = Math.max(annualData[year][person].maxConsecutiveLow, currentConsecutiveLow);
                }
            }
            if (lastYearProcessed !== "" && annualData[lastYearProcessed]?.[person]) {
                annualData[lastYearProcessed][person].maxConsecutiveHigh = Math.max(annualData[lastYearProcessed][person].maxConsecutiveHigh, currentConsecutiveHigh);
                annualData[lastYearProcessed][person].maxConsecutiveLow = Math.max(annualData[lastYearProcessed][person].maxConsecutiveLow, currentConsecutiveLow);
            }
        }

        if (Object.keys(annualData).length === 0) { setViewStatus(`Pas de données pour analyse.`); showViewLoader(false); return; }
        
        renderSummaryTable_ChartsView(annualData); // Rendre le tableau récapitulatif

        const sortedYears = Object.keys(annualData).sort((a, b) => b - a);
        for (const year of sortedYears) {
            const yearDataForDisplay = annualData[year]; const personsInYear = Object.keys(yearDataForDisplay).sort();
            if (personsInYear.length === 0) continue;
            const yearSectionElement = document.createElement('section'); yearSectionElement.className = 'annual-chart-group';
            const yearTitleElement = document.createElement('h2'); yearTitleElement.className = 'year-title';
            yearTitleElement.textContent = `Graphiques Détaillés - Année ${year}`; yearSectionElement.appendChild(yearTitleElement);
            const chartsGridContainer = document.createElement('div'); chartsGridContainer.className = 'charts-grid';
            yearSectionElement.appendChild(chartsGridContainer); chartsAnnualContainer.appendChild(yearSectionElement); 
            const addChartCardToGrid = (canvasIdBase, cardTitle, keyMetricText, renderFunction, chartDataArgs, isPie = false) => {
                const chartCard = document.createElement('div'); chartCard.className = 'chart-card';
                if (isPie) chartCard.classList.add('pie-chart-card'); 
                const titleElement = document.createElement('h3'); titleElement.className = 'chart-section-title';
                titleElement.textContent = cardTitle; chartCard.appendChild(titleElement);
                if (keyMetricText) {
                    const metricElement = document.createElement('p'); metricElement.className = 'chart-key-metric';
                    metricElement.textContent = keyMetricText; chartCard.appendChild(metricElement);
                }
                const chartContainerDiv = document.createElement('div'); chartContainerDiv.className = 'chart-container';
                const canvas = document.createElement('canvas'); const canvasId = `${canvasIdBase}-${year}`;
                canvas.id = canvasId; chartContainerDiv.appendChild(canvas); chartCard.appendChild(chartContainerDiv);
                chartsGridContainer.appendChild(chartCard); renderFunction(canvasId, ...chartDataArgs);
            };
            const totalHighWeeksThisYear = personsInYear.reduce((sum, p) => sum + (yearDataForDisplay[p]?.high || 0) , 0);
            const totalLowWeeksThisYear = personsInYear.reduce((sum, p) => sum + (yearDataForDisplay[p]?.low || 0), 0);
            addChartCardToGrid(`details-${year}`, "Totaux Semaines Hautes & Basses", // ID canvas unique
                `Hautes (> ${HIGH_THRESHOLD_HOURS}h): ${totalHighWeeksThisYear} | Basses (0 < h <= ${LOW_THRESHOLD_HOURS}h): ${totalLowWeeksThisYear}`, renderBarChart,
                [personsInYear, [{ label: `Semanas > ${HIGH_THRESHOLD_HOURS}h`, data: personsInYear.map(p => yearDataForDisplay[p]?.high || 0), backgroundColor: chartColors.danger },
                    { label: `Semanas <= ${LOW_THRESHOLD_HOURS}h (>0h)`, data: personsInYear.map(p => yearDataForDisplay[p]?.low || 0), backgroundColor: chartColors.secondary }], null]);
            const maxConsecutiveHighOverall = Math.max(0, ...personsInYear.map(p => yearDataForDisplay[p]?.maxConsecutiveHigh || 0));
            const maxConsecutiveLowOverall = Math.max(0, ...personsInYear.map(p => yearDataForDisplay[p]?.maxConsecutiveLow || 0));
            addChartCardToGrid(`consecutive-${year}`, "Plus Longues Séries Consécutives", // ID canvas unique
                `Max Hautes: ${maxConsecutiveHighOverall} sem. | Max Basses: ${maxConsecutiveLowOverall} sem.`, renderBarChart,
                [personsInYear, [{ label: `Max. Sem. Hautes Cons.`, data: personsInYear.map(p => yearDataForDisplay[p]?.maxConsecutiveHigh || 0), backgroundColor: chartColors.accent },
                    { label: `Max. Sem. Basses Cons.`, data: personsInYear.map(p => yearDataForDisplay[p]?.maxConsecutiveLow || 0), backgroundColor: chartColors.purpleSoft }], null]);
            let totalActive = 0; personsInYear.forEach(p => { totalActive += yearDataForDisplay[p]?.totalActiveWeeks || 0; });
            const otherWeeksCount = totalActive - totalHighWeeksThisYear - totalLowWeeksThisYear;
            if (totalActive > 0) {
                let pieLabels = ['Hautes (>35h)', `Basses (0<h≤35h)`];
                let pieData = [totalHighWeeksThisYear, totalLowWeeksThisYear];
                if (otherWeeksCount > 0 && (totalHighWeeksThisYear + totalLowWeeksThisYear < totalActive) ) { 
                    pieLabels.push(`Autres (ex: 0h)`); pieData.push(otherWeeksCount); 
                }
                addChartCardToGrid(`overall-pie-${year}`, `Répartition Globale des Semaines`, `Total semaines actives: ${totalActive}`, renderPieChart, // ID canvas unique
                    [pieLabels, pieData, null ], true);
            }
        }
        setViewStatus(`Graphiques annuels générés.`, "success");
    } catch (error) { console.error("Erreur (ChartsView):", error); setViewStatus(`Erreur: ${error.message}`, "error");
    } finally { showViewLoader(false); }
}

function renderSummaryTable_ChartsView(annualData) {
    const container = document.getElementById('chartsSummaryTableContainer');
    if (!container) { console.error("Conteneur #chartsSummaryTableContainer non trouvé."); return; }
    container.innerHTML = ''; 
    const allPersons = new Set(); const allYears = new Set();
    Object.keys(annualData).forEach(year => { allYears.add(year); Object.keys(annualData[year]).forEach(person => { allPersons.add(person); }); });
    if (allPersons.size === 0 || allYears.size === 0) { container.innerHTML = "<p>Pas de données pour le tableau récap.</p>"; return; }
    const sortedPersons = Array.from(allPersons).sort(); const sortedYears = Array.from(allYears).sort((a,b) => b-a);
    const table = document.createElement('table'); table.id = 'summaryAnnualHoursTable'; table.className = 'table';
    const thead = table.createTHead(); const headerRow = thead.insertRow();
    const thPerson = document.createElement('th'); thPerson.textContent = 'Personne'; headerRow.appendChild(thPerson);
    sortedYears.forEach(year => { const thYear = document.createElement('th'); thYear.innerHTML = `${year}<br>(<span class="high-weeks">H</span>/<span class="low-weeks">B</span>)`; headerRow.appendChild(thYear); });
    const tbody = table.createTBody();
    sortedPersons.forEach(person => {
        const row = tbody.insertRow(); row.insertCell().textContent = person;
        sortedYears.forEach(year => {
            const cell = row.insertCell(); const data = annualData[year]?.[person];
            if (data) { cell.innerHTML = `<span class="high-weeks">${data.high || 0}</span> / <span class="low-weeks">${data.low || 0}</span>`; } 
            else { cell.innerHTML = `<span class="no-data-cell">- / -</span>`; }
        });
    });
    container.appendChild(table);
}

function renderBarChart(canvasId, labels, datasetsConfig, titleTextInternal) {
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { console.error(`Canvas ${canvasId} (renderBarChart) non trouvé`); return; }
    const ctx = chartCanvas.getContext('2d');
    const newChart = new Chart(ctx, {
        type: 'bar', data: { labels: labels,
            datasets: datasetsConfig.map(ds => ({ label: ds.label, data: ds.data, backgroundColor: ds.backgroundColor,
                borderColor: (typeof ds.backgroundColor === 'string' ? ds.backgroundColor.replace(/, ?(0\.\d+|[01])\)/, ', 1)') : 'rgba(0,0,0,0.1)'),
                borderWidth: 0, borderRadius: { topLeft: 4, topRight: 4 }, barPercentage: 0.7, categoryPercentage: 0.8,
            }))},
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { title: { display: !!titleTextInternal, text: titleTextInternal || '', font: { family: getCssVariableValue('--font-family-headings', 'Poppins'), size: 13 }, color: getCssVariableValue('--text-primary', '#2E3440'), padding: {bottom: 5} },
                legend: { position: 'bottom', align: 'start', labels: { padding: 15, font: {family: getCssVariableValue('--font-family-main', 'Inter') , size: 11}, color: getCssVariableValue('--text-secondary', '#4C566A'), usePointStyle: true, pointStyle: 'rectRounded' } },
                tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(46, 52, 64, 0.9)', titleFont: {family: getCssVariableValue('--font-family-headings', 'Poppins'), size: 12, weight: '600'}, bodyFont: {family: getCssVariableValue('--font-family-main', 'Inter'), size: 11}, padding: 10, cornerRadius: 4, boxPadding: 4, titleMarginBottom: 6, bodySpacing: 4 }
            },
            scales: { y: { beginAtZero: true, title: { display: false }, ticks: { font: {family: getCssVariableValue('--font-family-main', 'Inter'), size: 10}, color: getCssVariableValue('--text-secondary', '#4C566A'), padding: 6, stepSize: Math.ceil(Math.max(0, ...(datasetsConfig && datasetsConfig.length > 0 ? datasetsConfig.flatMap(dset => dset.data || []) : [0]))/5) || 1, precision:0 }, grid: { drawBorder: false, color: getCssVariableValue('--border-color', 'rgba(76,86,106,0.15)'), borderDash: [2, 4] } },
                      x: { title: { display: false }, ticks: {font:{family: getCssVariableValue('--font-family-main', 'Inter'), size: 10}, color: getCssVariableValue('--text-secondary', '#4C566A'), padding: 6}, grid: { display: false } }
            },
            layout: { padding: { top: 5, left: 0, right: 0, bottom: 0 } }
        }
    });
    activeChartInstances.push(newChart);
}

function renderPieChart(canvasId, labels, dataValues, titleTextInternal) {
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { console.error(`Canvas ${canvasId} (renderPieChart) non trouvé`); return; }
    const ctx = chartCanvas.getContext('2d');
    const cardBgColor = getCssVariableValue('--bg-card', '#e5e9f0');

    const newChart = new Chart(ctx, {
        type: 'doughnut', data: { labels: labels,
            datasets: [{ label: 'Répartition', data: dataValues,
                backgroundColor: chartColors.pieColorsArray.slice(0, dataValues.length),
                borderColor: cardBgColor, borderWidth: 2.5, hoverOffset: 10, hoverBorderColor: cardBgColor,
            }]},
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%',
            plugins: { title: { display: !!titleTextInternal, text: titleTextInternal || '', font: { family: getCssVariableValue('--font-family-headings', 'Poppins')}, color: getCssVariableValue('--text-primary', '#2E3440'), padding: {bottom:5}},
                legend: { position: 'bottom', align: 'center', labels: {padding: 15, font:{family: getCssVariableValue('--font-family-main', 'Inter'), size:11}, color: getCssVariableValue('--text-secondary', '#4C566A'), usePointStyle: true, pointStyle: 'circle', boxWidth:10, boxHeight:10}},
                tooltip: { backgroundColor: 'rgba(46, 52, 64, 0.9)', titleFont: {family: getCssVariableValue('--font-family-headings', 'Poppins'), size: 12, weight: '600'}, bodyFont: {family: getCssVariableValue('--font-family-main', 'Inter'), size: 11},
                    padding: 10, cornerRadius: 4, boxPadding: 4, titleMarginBottom: 6, bodySpacing: 4,
                    callbacks: { label: function(context) { let label = context.label || ''; if (label) label += ': '; const value = context.parsed; if (value !== null) label += value + ' sem.'; const total = context.dataset.data.reduce((acc, val) => acc + val, 0); const percentage = total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%'; return `${label} (${percentage})`; }}} // J'ai vérifié cette ligne, elle est correcte.
            },
            layout: { padding: 15 }
        }
    });
    activeChartInstances.push(newChart);
}
