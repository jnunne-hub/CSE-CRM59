// views/charts.js

import { db, showViewLoader, setViewStatus } from '../script.js';

const HIGH_THRESHOLD_HOURS = 35;
// Pour que les semaines à 35h soient incluses dans les basses, LOW_THRESHOLD_HOURS reste 35,
// et la condition sera hours <= LOW_THRESHOLD_HOURS
const LOW_THRESHOLD_HOURS = 35; 

let activeChartInstances = []; 

const chartColors = {
    danger: 'rgba(191, 97, 106, 0.75)',   // Semaines Hautes
    secondary: 'rgba(136, 192, 208, 0.75)',// Semaines Basses (incluant 35h)
    accent: 'rgba(235, 203, 139, 0.75)',  
    purpleSoft: 'rgba(180, 142, 173, 0.75)',
    
    pieColorsArray: [ 
        'rgba(191, 97, 106, 0.85)',   // Hautes (danger)
        'rgba(136, 192, 208, 0.85)',  // Basses (secondary)
        'rgba(163, 190, 140, 0.85)',  // Normales (success - si on les distinguait encore)
        // Ajouter plus de couleurs si besoin pour le pie chart s'il y a plus de 2 catégories principales
        'rgba(94, 129, 172, 0.85)',   // primary
        'rgba(235, 203, 139, 0.85)',  // accent
        'rgba(129, 161, 193, 0.85)'   // info
    ]
};

function getCssVariableValue(variableName, fallback = '#000000') {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
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
    }
    loadAndProcessData_ChartsView();
}

export function cleanupChartsView() {
    activeChartInstances.forEach(chart => chart.destroy());
    activeChartInstances = [];
    console.log("Instances de graphiques nettoyées.");
}

async function exportChartsViewToPdfWithJsPDF() {
    const exportButton = document.getElementById('exportChartsToPdfButton');
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
        alert("Librairies PDF non chargées."); return;
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
        doc.setFontSize(18); doc.setFont("helvetica", "bold");
        const mainTitleText = document.querySelector('#charts-exportable-content > h1')?.textContent || "Analyse Détaillée des Heures";
        const mainTitleLines = doc.splitTextToSize(mainTitleText, usableWidth);
        doc.text(mainTitleLines, pageWidth / 2, currentY, { align: 'center' });
        currentY += (mainTitleLines.length * 7) + 10;
        const annualGroups = document.querySelectorAll('#charts-annual-summary-container .annual-chart-group');
        for (const group of annualGroups) {
            if (!pageJustAdded) checkAndAddPage(20); else currentY = PAGE_MARGIN;
            pageJustAdded = false;
            const yearTitleElement = group.querySelector('.year-title');
            if (yearTitleElement) {
                doc.setFontSize(14); doc.setFont("helvetica", "bold");
                doc.text(yearTitleElement.textContent, PAGE_MARGIN, currentY); currentY += 10;
            }
            const chartCards = group.querySelectorAll('.chart-card');
            for (const card of chartCards) {
                if (!pageJustAdded) checkAndAddPage(15); else currentY = Math.max(currentY, PAGE_MARGIN);
                 pageJustAdded = false;
                const sectionTitleElement = card.querySelector('.chart-section-title');
                if (sectionTitleElement) {
                    doc.setFontSize(11); doc.setFont("helvetica", "bolditalic");
                    doc.text(sectionTitleElement.textContent, PAGE_MARGIN, currentY); currentY += 6;
                }
                const keyMetricElement = card.querySelector('.chart-key-metric');
                 if (keyMetricElement) {
                    doc.setFontSize(9); doc.setFont("helvetica", "italic");
                    doc.text(keyMetricElement.textContent, PAGE_MARGIN, currentY); currentY += 5;
                }
                const canvasElement = card.querySelector('canvas');
                if (canvasElement) {
                    await new Promise(resolve => setTimeout(resolve, 250));
                    try {
                        const canvasImg = await html2canvas(canvasElement, { scale: 2, backgroundColor: '#FFFFFF', logging: false, useCORS: true });
                        const imgData = canvasImg.toDataURL('image/png'); const imgProps = doc.getImageProperties(imgData);
                        let imgHeight = (imgProps.height * usableWidth) / imgProps.width; let imgWidth = usableWidth;
                        const availableHeight = doc.internal.pageSize.getHeight() - currentY - PAGE_MARGIN;
                        if (imgHeight > availableHeight) {
                            if (availableHeight < 40) { checkAndAddPage(imgHeight); imgHeight = Math.min(imgHeight, doc.internal.pageSize.getHeight() - 2 * PAGE_MARGIN); } 
                            else { imgHeight = availableHeight; }
                            imgWidth = (imgProps.width * imgHeight) / imgProps.height;
                        }
                        if (!pageJustAdded) checkAndAddPage(imgHeight + 5); else currentY = Math.max(currentY, PAGE_MARGIN);
                         pageJustAdded = false;
                        const imgX = (pageWidth - imgWidth) / 2;
                        doc.addImage(imgData, 'PNG', imgX, currentY, imgWidth, imgHeight); currentY += imgHeight + 8;
                    } catch(e) {
                        console.error("Erreur capture canvas:", canvasElement.id, e);
                        if(!pageJustAdded) checkAndAddPage(7); else currentY = Math.max(currentY, PAGE_MARGIN); pageJustAdded=false;
                        doc.setTextColor(191, 97, 106); doc.text("Erreur capture du graphique.", PAGE_MARGIN, currentY);
                        doc.setTextColor(46, 52, 64); currentY += 7;
                    }
                }
            }
            currentY += 8; 
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
    if (!chartsAnnualContainer) { console.error("#charts-annual-summary-container non trouvé."); showViewLoader(false); return; }
    chartsAnnualContainer.innerHTML = '';

    try {
        const querySnapshot = await db.collection("heuresTravail").orderBy("personne").orderBy("semaine", "asc").get();
        if (querySnapshot.empty) { setViewStatus('Aucune donnée Firebase.'); showViewLoader(false); return; }
        const annualData = {}; const personWeeklyData = {};
        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.personne || typeof data.heures !== 'number' || !data.semaine) return;
            const year = data.semaine.substring(0, 4); const hours = data.heures;
            if (!annualData[year]) annualData[year] = {};
            if (!annualData[year][data.personne]) {
                annualData[year][data.personne] = { high: 0, low: 0, totalActiveWeeks: 0, weeklyHours: {}, maxConsecutiveHigh: 0, maxConsecutiveLow: 0 };
            }
            if (!personWeeklyData[data.personne]) personWeeklyData[data.personne] = {};
            annualData[year][data.personne].totalActiveWeeks++;
            annualData[year][data.personne].weeklyHours[data.semaine] = hours;
            // ---------- MODIFICATION LOGIQUE DE COMPTAGE ----------
            if (hours > HIGH_THRESHOLD_HOURS) { // Semaines hautes : > 35h
                annualData[year][data.personne].high++;
            } else if (hours > 0 && hours <= LOW_THRESHOLD_HOURS) { // Semaines basses : 0 < heures <= 35h
                annualData[year][data.personne].low++;
            } // Les semaines à 0 heure ne sont comptées ni en haut ni en bas.
            // ----------------------------------------------------
            personWeeklyData[data.personne][data.semaine] = hours;
        });
        
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
                // ---------- MODIFICATION LOGIQUE SÉRIES CONSÉCUTIVES ----------
                if (hours > HIGH_THRESHOLD_HOURS) { // Série haute
                    currentConsecutiveHigh++; currentConsecutiveLow = 0; 
                } else if (hours > 0 && hours <= LOW_THRESHOLD_HOURS) { // Série basse
                    currentConsecutiveLow++; currentConsecutiveHigh = 0; 
                } else { // Rompt les deux séries (0h ou heures invalides)
                    currentConsecutiveHigh = 0; currentConsecutiveLow = 0; 
                }
                // ------------------------------------------------------------
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
        const sortedYears = Object.keys(annualData).sort((a, b) => b - a);
        for (const year of sortedYears) {
            const yearDataForDisplay = annualData[year]; const personsInYear = Object.keys(yearDataForDisplay).sort();
            if (personsInYear.length === 0) continue;
            const yearSectionElement = document.createElement('section'); yearSectionElement.className = 'annual-chart-group';
            const yearTitleElement = document.createElement('h2'); yearTitleElement.className = 'year-title';
            yearTitleElement.textContent = `Analyse pour l'Année ${year}`; yearSectionElement.appendChild(yearTitleElement);
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
            const totalHighWeeksThisYear = personsInYear.reduce((sum, p) => sum + yearDataForDisplay[p].high, 0);
            const totalLowWeeksThisYear = personsInYear.reduce((sum, p) => sum + yearDataForDisplay[p].low, 0);
            addChartCardToGrid(`details`, "Totaux Semaines Hautes & Basses",
                `Hautes (> ${HIGH_THRESHOLD_HOURS}h): ${totalHighWeeksThisYear} | Basses (0 < h <= ${LOW_THRESHOLD_HOURS}h): ${totalLowWeeksThisYear}`, renderBarChart,
                [personsInYear, [{ label: `Semanas > ${HIGH_THRESHOLD_HOURS}h`, data: personsInYear.map(p => yearDataForDisplay[p].high), backgroundColor: chartColors.danger },
                    { label: `Semanas <= ${LOW_THRESHOLD_HOURS}h (>0h)`, data: personsInYear.map(p => yearDataForDisplay[p].low), backgroundColor: chartColors.secondary }], null]);
            
            const maxConsecutiveHighOverall = Math.max(0, ...personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveHigh));
            const maxConsecutiveLowOverall = Math.max(0, ...personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveLow));
            addChartCardToGrid(`consecutive`, "Plus Longues Séries Consécutives",
                `Max Hautes: ${maxConsecutiveHighOverall} sem. | Max Basses: ${maxConsecutiveLowOverall} sem.`, renderBarChart,
                [personsInYear, [{ label: `Max. Sem. Hautes Cons.`, data: personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveHigh), backgroundColor: chartColors.accent },
                    { label: `Max. Sem. Basses Cons.`, data: personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveLow), backgroundColor: chartColors.purpleSoft }], null]);
            
            let totalActive = 0; personsInYear.forEach(p => { totalActive += yearDataForDisplay[p].totalActiveWeeks; });
            // Pour le pie chart, nous n'avons plus de catégorie "normale" explicite si les semaines à 35h sont "basses".
            // Le total des semaines actives qui ne sont NI hautes NI basses serait 0 ou des semaines à 0h.
            // Si vous voulez toujours un 3ème segment pour "autres" (semaines à 0h, par exemple)
            const otherWeeksCount = totalActive - totalHighWeeksThisYear - totalLowWeeksThisYear;

            if (totalActive > 0) {
                let pieLabels = ['Hautes', `Basses (<= ${LOW_THRESHOLD_HOURS}h)`];
                let pieData = [totalHighWeeksThisYear, totalLowWeeksThisYear];
                if (otherWeeksCount > 0) { // Ajouter une catégorie "Autres" seulement si pertinent
                    pieLabels.push('Autres (ex: 0h)');
                    pieData.push(otherWeeksCount);
                }
                addChartCardToGrid(`overall-pie`, `Répartition Globale des Semaines`, `Total Actives: ${totalActive} semaines`, renderPieChart,
                    [pieLabels, pieData, null ], true);
            }
        }
        setViewStatus(`Graphiques annuels générés.`, "success");
    } catch (error) { console.error("Erreur (ChartsView):", error); setViewStatus(`Erreur: ${error.message}`, "error");
    } finally { showViewLoader(false); }
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
            plugins: { title: { display: !!titleTextInternal, text: titleTextInternal || '', font: { family: getCssVariableValue('--font-family-headings', 'Poppins') }, color: getCssVariableValue('--text-primary', '#2E3440'), padding: {bottom: 5} },
                legend: { position: 'bottom', align: 'start', labels: { padding: 15, font: {family: getCssVariableValue('--font-family-main', 'Inter') , size: 11}, color: getCssVariableValue('--text-secondary', '#4C566A'), usePointStyle: true, pointStyle: 'rectRounded' } },
                tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(46, 52, 64, 0.9)', titleFont: {family: getCssVariableValue('--font-family-headings', 'Poppins'), size: 12, weight: '600'}, bodyFont: {family: getCssVariableValue('--font-family-main', 'Inter'), size: 11}, padding: 10, cornerRadius: 4, boxPadding: 4, titleMarginBottom: 6, bodySpacing: 4 }
            },
            scales: { y: { beginAtZero: true, title: { display: false }, ticks: { font: {family: getCssVariableValue('--font-family-main', 'Inter'), size: 10}, color: getCssVariableValue('--text-secondary', '#4C566A'), padding: 6, stepSize: Math.ceil(Math.max(0, ...datasetsConfig.flatMap(dset => dset.data || []))/5) || 1, precision:0 }, grid: { drawBorder: false, color: getCssVariableValue('--border-color', 'rgba(76,86,106,0.15)'), borderDash: [2, 4] } },
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
            plugins: { 
                title: { display: !!titleTextInternal, text: titleTextInternal || '', font: { family: getCssVariableValue('--font-family-headings', 'Poppins')}, color: getCssVariableValue('--text-primary', '#2E3440'), padding: {bottom:5}},
                legend: { position: 'bottom', align: 'center', labels: {padding: 15, font:{family: getCssVariableValue('--font-family-main', 'Inter'), size:11}, color: getCssVariableValue('--text-secondary', '#4C566A'), usePointStyle: true, pointStyle: 'circle', boxWidth:10, boxHeight:10}}
                // Tooltip commenté pour le test
                /*
                tooltip: { backgroundColor: 'rgba(46, 52, 64, 0.9)', titleFont: {family: getCssVariableValue('--font-family-headings', 'Poppins'), size: 12, weight: '600'}, bodyFont: {family: getCssVariableValue('--font-family-main', 'Inter'), size: 11},
                    padding: 10, cornerRadius: 4, boxPadding: 4, titleMarginBottom: 6, bodySpacing: 4,
                    callbacks: { label: function(context) { let label = context.label || ''; if (label) label += ': '; const value = context.parsed; if (value !== null) label += value + ' sem.'; const total = context.dataset.data.reduce((acc, val) => acc + val, 0); const percentage = total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%'; return `${label} (${percentage})`; }}}
                }
                */
            },
            layout: { padding: 15 }
        }
    });
    activeChartInstances.push(newChart);
}
