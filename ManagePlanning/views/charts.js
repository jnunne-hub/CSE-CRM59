// views/charts.js

import { db, showViewLoader, setViewStatus } from '../script.js';

const HIGH_THRESHOLD_HOURS = 35;
const LOW_THRESHOLD_HOURS = 35; 

let activeChartInstances = []; 

const MONTH_NAMES_FR_CHARTS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const chartColors = {
    danger: 'rgba(191, 97, 106, 0.75)',
    secondary: 'rgba(136, 192, 208, 0.75)',
    accent: 'rgba(235, 203, 139, 0.75)',
    purpleSoft: 'rgba(180, 142, 173, 0.75)',
    pieColorsArray: [ 
        'rgba(191, 97, 106, 0.85)', 'rgba(136, 192, 208, 0.85)', 'rgba(163, 190, 140, 0.85)',
        'rgba(94, 129, 172, 0.85)', 'rgba(235, 203, 139, 0.85)', 'rgba(129, 161, 193, 0.85)'
    ]
};

// --- Fonctions Utilitaires ---
function getCssVariableValue(variableName, fallback = '#000000') {
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.documentElement) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
        
        if (variableName.endsWith('-rgb-array')) {
            if (value) { // Si la variable CSS est définie et non vide
                return value.split(',').map(Number);
            } else if (Array.isArray(fallback)) { // Si la variable CSS n'est pas définie MAIS le fallback est déjà un tableau
                return fallback; // Retourner directement le tableau fallback
            } else if (typeof fallback === 'string') { // Si le fallback est une chaîne (improbable pour -rgb-array mais pour être complet)
                return fallback.split(',').map(Number);
            } else { // Cas d'erreur ou fallback inattendu
                console.warn(`Fallback inattendu pour ${variableName}:`, fallback, "- utilisation de [0,0,0]");
                return [0, 0, 0]; // Une couleur par défaut sûre
            }
        }
        // Pour les variables CSS classiques (non -rgb-array)
        return value || (typeof fallback === 'string' ? fallback : '#000000'); // S'assurer que le fallback est une chaîne si value est vide
    }
    // Si window/document n'existent pas (SSR par exemple)
     if (variableName.endsWith('-rgb-array')) {
        return Array.isArray(fallback) ? fallback : (typeof fallback === 'string' ? fallback.split(',').map(Number) : [0,0,0]);
    }
    return typeof fallback === 'string' ? fallback : '#000000';
}
function showPdfSpinner() {
    const spinnerOverlay = document.getElementById('pdfSpinnerOverlay');
    if (spinnerOverlay) spinnerOverlay.style.display = 'flex';
}

function hidePdfSpinner() {
    const spinnerOverlay = document.getElementById('pdfSpinnerOverlay');
    if (spinnerOverlay) spinnerOverlay.style.display = 'none';
}

function getMonthFromWeek(year, weekNumber) {
    const firstDayOfYear = new Date(year, 0, 1);
    const dateInWeek = new Date(firstDayOfYear.valueOf() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000 + 3 * 24 * 60 * 60 * 1000);
    const month = dateInWeek.getMonth() + 1; 
    return String(month).padStart(2, '0');
}

// --- Initialisation et Nettoyage de la Vue ---
export function initChartsView() {
    console.log("Initialisation de la vue Charts");
    const refreshButton = document.getElementById('refreshButtonChart');
    const exportPdfButton = document.getElementById('exportChartsToPdfButton');

    if (refreshButton) refreshButton.addEventListener('click', loadAndProcessData_ChartsView);
    if (exportPdfButton) exportPdfButton.addEventListener('click', exportChartsViewToPdfWithJsPDF);
    
    if (typeof Chart === 'undefined') { setViewStatus("Chart.js n'est pas chargé.", "error"); return; }
    
    // Vérification pour jsPDF et AutoTable pour l'export PDF
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined' || 
        typeof html2canvas === 'undefined' || // html2canvas est aussi nécessaire pour les graphiques
        (typeof window.jspdf.jsPDF.API.autoTable === 'undefined' && exportPdfButton) ) { // Vérifier autotable seulement si le bouton existe
        console.warn("jsPDF, html2canvas ou jspdf-autotable non chargé. Export PDF pourrait être limité ou désactivé.");
        if(exportPdfButton) {
            exportPdfButton.disabled = true;
            exportPdfButton.title = "Librairies d'export PDF manquantes ou non chargées.";
        }
    } else {
        if(exportPdfButton) {
            exportPdfButton.disabled = false;
            exportPdfButton.title = "";
        }
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


// --- Export PDF ---
async function exportChartsViewToPdfWithJsPDF() {
    const exportButton = document.getElementById('exportChartsToPdfButton');
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined' || typeof html2canvas === 'undefined') {
        alert("Les librairies PDF (jsPDF ou html2canvas) ne sont pas chargées."); return;
    }
    if (typeof window.jspdf.jsPDF.API.autoTable === 'undefined') {
        alert("La librairie jspdf-autotable est nécessaire pour exporter les tableaux en PDF."); return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    setViewStatus("Génération du PDF...", "info");
    if (exportButton) exportButton.disabled = true;
    showPdfSpinner();
    const originalChartDefaultsAnimation = Chart.defaults.animation;
    Chart.defaults.animation = false; // Désactiver animations pour capture stable

    const PAGE_MARGIN = 15; 
    let currentY = PAGE_MARGIN;
    const pageWidth = doc.internal.pageSize.getWidth(); 
    const usableWidth = pageWidth - (2 * PAGE_MARGIN);
    let pageJustAdded = false;

    function checkAndAddPage(neededHeight = 20) {
        if (currentY + neededHeight > doc.internal.pageSize.getHeight() - PAGE_MARGIN) {
            doc.addPage(); currentY = PAGE_MARGIN; pageJustAdded = true; return true;
        }
        pageJustAdded = false; return false;
    }
    
    // Helper pour ajouter un titre de section au PDF
    function addPdfSectionTitle(titleText, fontSize = 12) {
        if (checkAndAddPage(fontSize * 0.5 + 8)) currentY = PAGE_MARGIN; // Vérifier si on a la place pour le titre
        doc.setFontSize(fontSize);
        doc.setFont("helvetica", "bold");
        const lines = doc.splitTextToSize(titleText, usableWidth);
        doc.text(lines, PAGE_MARGIN, currentY);
        currentY += (lines.length * fontSize * 0.35) + 5; // Ajuster l'espacement après le titre
    }


    try {
        // Titre principal du document PDF
        doc.setFontSize(16); 
        doc.setFont("helvetica", "bold");
        const mainTitleElement = document.querySelector('#charts-exportable-content > h1');
        const mainTitleText = mainTitleElement ? mainTitleElement.textContent : "Analyse Détaillée des Heures";
        const mainTitleLines = doc.splitTextToSize(mainTitleText, usableWidth);
        doc.text(mainTitleLines, pageWidth / 2, currentY, { align: 'center' });
        currentY += (mainTitleLines.length * 6) + 10; 

        // 1. Tableau Récapitulatif Annuel
        const summaryTableSection = document.getElementById('summary-annual-section');
        const summaryTableEl = document.getElementById('summaryAnnualHoursTable');
        if (summaryTableSection && summaryTableEl && summaryTableEl.rows.length > 1) { // Vérifier qu'il y a des données
            const titleEl = summaryTableSection.querySelector('.summary-table-title.section-title');
            if (titleEl) addPdfSectionTitle(titleEl.textContent);
            
            await new Promise(resolve => setTimeout(resolve, 50)); // Petit délai pour le rendu DOM
            doc.autoTable({
                html: '#summaryAnnualHoursTable', startY: currentY, theme: 'grid',
                headStyles: { fillColor: getCssVariableValue('--primary-color-rgb-array', [94, 129, 172]) }, 
                styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
                didDrawPage: (data) => { currentY = data.cursor.y + 5; pageJustAdded = true; }, 
                showHead: 'firstPage' 
            });
            currentY = doc.autoTable.previous.finalY + 10; 
        } else {
            console.log("Tableau récapitulatif annuel non exporté (absent ou vide).");
        }

        // 2. Tableaux de Détail Mensuel par Personne
        const monthlyHighWeeksSection = document.getElementById('monthly-high-weeks-details-section');
        if (monthlyHighWeeksSection) {
            const mainTitleEl = monthlyHighWeeksSection.querySelector('h2.section-title');
            const tables = monthlyHighWeeksSection.querySelectorAll('table.monthly-summary-table');
            if (mainTitleEl && tables.length > 0) {
                 addPdfSectionTitle(mainTitleEl.textContent);
            }
            for (const tableEl of tables) {
                if (tableEl.rows.length <= 1) continue; // Sauter les tableaux vides (seulement en-tête)

                const personTitleEl = tableEl.previousElementSibling; 
                if (personTitleEl && personTitleEl.classList.contains('person-year-title')) {
                    if (checkAndAddPage(12)) currentY = PAGE_MARGIN; // Espace pour le sous-titre
                    doc.setFontSize(10); doc.setFont("helvetica", "bolditalic");
                    doc.text(personTitleEl.textContent, PAGE_MARGIN, currentY); currentY += 6;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
                doc.autoTable({
                    html: tableEl, startY: currentY, theme: 'grid',
                    headStyles: { fillColor: getCssVariableValue('--nord11-rgb-array', [191, 97, 106]) }, 
                    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
                    didDrawPage: (data) => { currentY = data.cursor.y + 5; pageJustAdded = true; }, 
                    showHead: 'firstPage'
                });
                currentY = doc.autoTable.previous.finalY + 7; 
            }
            if (tables.length > 0) currentY += 5; 
        } else {
             console.log("Section des tableaux mensuels détaillés non trouvée.");
        }
        
        // Fonction pour exporter un groupe de graphiques (canvas)
        async function exportChartGroupToPdf(groupElementContainerId, docInstance) {
            const groupElementContainer = document.getElementById(groupElementContainerId);
            if (!groupElementContainer) {
                console.log(`Conteneur de groupe de graphiques ${groupElementContainerId} non trouvé.`);
                return;
            }

            const chartGroups = groupElementContainer.querySelectorAll('.aggregated-chart-group, .annual-chart-group');
            for (const group of chartGroups) {
                if (checkAndAddPage(20)) currentY = PAGE_MARGIN; pageJustAdded = false;
                
                const groupTitleElement = group.querySelector('h2.section-title'); 
                if (groupTitleElement) {
                    addPdfSectionTitle(groupTitleElement.textContent, 12);
                }
                const chartCards = group.querySelectorAll('.chart-card');
                for (const card of chartCards) {
                    if (checkAndAddPage(60)) currentY = PAGE_MARGIN; // Estimation hauteur graphique
                     pageJustAdded = false;
                    const cardTitleElement = card.querySelector('.chart-section-title');
                    if (cardTitleElement) {
                        doc.setFontSize(10); doc.setFont("helvetica", "bolditalic");
                        doc.text(cardTitleElement.textContent, PAGE_MARGIN, currentY); currentY += 5;
                    }
                    const keyMetricElement = card.querySelector('.chart-key-metric');
                    if (keyMetricElement) {
                        doc.setFontSize(8); doc.setFont("helvetica", "italic");
                        doc.text(keyMetricElement.textContent, PAGE_MARGIN, currentY); currentY += 4;
                    }
                    const canvasElement = card.querySelector('canvas');
                    if (canvasElement && canvasElement.height > 0 && canvasElement.width > 0) { // S'assurer que le canvas a des dimensions
                        await new Promise(resolve => setTimeout(resolve, 200)); // Délai un peu plus court
                        try {
                            const canvasImg = await html2canvas(canvasElement, { scale: 2, backgroundColor: '#FFFFFF', logging: false, useCORS: true });
                            const imgData = canvasImg.toDataURL('image/png'); 
                            const imgProps = docInstance.getImageProperties(imgData);
                            let imgHeight = (imgProps.height * usableWidth * 0.85) / imgProps.width; // Légèrement plus petit
                            let imgWidth = usableWidth * 0.85;
                            
                            const spaceForImg = docInstance.internal.pageSize.getHeight() - currentY - PAGE_MARGIN;
                            if (imgHeight > spaceForImg) {
                                if (spaceForImg < 40) { // Si vraiment peu de place, nouvelle page
                                     checkAndAddPage(imgHeight + 10); // Forcer nouvelle page + marge
                                     imgHeight = Math.min(imgHeight, docInstance.internal.pageSize.getHeight() - (2 * PAGE_MARGIN) - 10);
                                } else { // Sinon, réduire pour s'adapter
                                    imgHeight = spaceForImg - 5; 
                                }
                                imgWidth = (imgProps.width * imgHeight) / imgProps.height;
                            }
                            if (checkAndAddPage(imgHeight + 10)) currentY = PAGE_MARGIN; // Marge après l'image
                            const imgX = (pageWidth - imgWidth) / 2;
                            docInstance.addImage(imgData, 'PNG', imgX, currentY, imgWidth, imgHeight); 
                            currentY += imgHeight + 8;
                        } catch(e) {
                            console.error("Erreur capture canvas:", canvasElement.id, e);
                            if (checkAndAddPage(10)) currentY = PAGE_MARGIN;
                            docInstance.setTextColor(...getCssVariableValue('--nord11-rgb-array', [191, 97, 106])); 
                            docInstance.text("Erreur capture du graphique.", PAGE_MARGIN, currentY);
                            docInstance.setTextColor(...getCssVariableValue('--nord3-rgb-array', [46, 52, 64])); currentY += 7; 
                        }
                    } else {
                         console.log("Canvas non exporté (absent ou dimensions nulles):", card.querySelector('.chart-section-title')?.textContent);
                    }
                }
                currentY += 6; 
            }
        }

        // 3. Graphiques d'Évolution Mensuelle Globale
        await exportChartGroupToPdf('charts-aggregated-monthly-container', doc);
        
        // 4. Graphiques Détaillés par Personne et par Année
        await exportChartGroupToPdf('charts-annual-summary-container', doc);

        doc.save('analyse_heures_graphiques_tableaux.pdf'); 
        setViewStatus("PDF généré avec succès (incluant tableaux et graphiques).", "success");
    } catch (error) { 
        console.error("Erreur majeure lors de la génération du PDF:", error); 
        setViewStatus("Erreur majeure lors de la génération du PDF.", "error");
    } finally { 
        Chart.defaults.animation = originalChartDefaultsAnimation; 
        if (exportButton) exportButton.disabled = false; 
        hidePdfSpinner(); 
    }
}


// --- Chargement et Traitement des Données ---
async function loadAndProcessData_ChartsView() {
    if (!db) { setViewStatus("Firebase non initialisé.", "error"); return; }
    if (typeof Chart === 'undefined') { setViewStatus("Chart.js non chargé.", "error"); return; }
    
    showViewLoader(true); 
    setViewStatus('Chargement des données...'); 
    cleanupChartsView(); 
    
    const chartsAnnualContainer = document.getElementById('charts-annual-summary-container');
    const summaryTableContainer = document.getElementById('chartsSummaryTableContainer');
    const monthlyHighWeeksContainer = document.getElementById('chartsMonthlyHighWeeksContainer');
    const aggregatedMonthlyContainer = document.getElementById('charts-aggregated-monthly-container');

    if (!chartsAnnualContainer || !summaryTableContainer || !monthlyHighWeeksContainer || !aggregatedMonthlyContainer) {
        console.error("Un ou plusieurs conteneurs cibles (charts/tables) sont manquants dans le DOM."); 
        setViewStatus("Erreur DOM: Conteneurs d'affichage manquants.", "error");
        showViewLoader(false); return; 
    }
    
    chartsAnnualContainer.innerHTML = ''; summaryTableContainer.innerHTML = '';
    monthlyHighWeeksContainer.innerHTML = ''; aggregatedMonthlyContainer.innerHTML = '';

    try {
        const querySnapshot = await db.collection("heuresTravail").orderBy("semaine", "asc").get();
        if (querySnapshot.empty) { 
            setViewStatus('Aucune donnée Firestore pour les graphiques.'); 
            showViewLoader(false); return; 
        }
        
        const annualData = {}; const personWeeklyData = {}; 
        const monthlyHighWeeksData = {}; const aggregatedMonthlyData = {};

        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.personne || typeof data.heures !== 'number' || !data.semaine) return;
            const year = data.semaine.substring(0, 4); 
            const weekNumStrMatch = data.semaine.match(/-W(\d+)$/);
            if (!weekNumStrMatch || !weekNumStrMatch[1]) return;
            const weekNumber = parseInt(weekNumStrMatch[1]);
            const hours = parseFloat(data.heures); 
            if (isNaN(hours) || isNaN(weekNumber) || !year.match(/^\d{4}$/)) return;

            if (!annualData[year]) annualData[year] = {};
            if (!annualData[year][data.personne]) {
                annualData[year][data.personne] = { high: 0, low: 0, totalActiveWeeks: 0, weeklyHours: {}, maxConsecutiveHigh: 0, maxConsecutiveLow: 0 };
            }
            if (!personWeeklyData[data.personne]) personWeeklyData[data.personne] = {};
            
            annualData[year][data.personne].totalActiveWeeks++;
            annualData[year][data.personne].weeklyHours[data.semaine] = hours;
            personWeeklyData[data.personne][data.semaine] = hours;

            const month = getMonthFromWeek(parseInt(year), weekNumber);
            if (!aggregatedMonthlyData[year]) aggregatedMonthlyData[year] = {};
            if (!aggregatedMonthlyData[year][month]) aggregatedMonthlyData[year][month] = { high: 0, low: 0 };

            if (hours > HIGH_THRESHOLD_HOURS) { 
                annualData[year][data.personne].high++; 
                aggregatedMonthlyData[year][month].high++; 
                if (!monthlyHighWeeksData[year]) monthlyHighWeeksData[year] = {};
                if (!monthlyHighWeeksData[year][data.personne]) monthlyHighWeeksData[year][data.personne] = {};
                if (!monthlyHighWeeksData[year][data.personne][month]) monthlyHighWeeksData[year][data.personne][month] = 0;
                monthlyHighWeeksData[year][data.personne][month]++;
            } else if (hours > 0 && hours <= LOW_THRESHOLD_HOURS) { 
                annualData[year][data.personne].low++; 
                aggregatedMonthlyData[year][month].low++; 
            }
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

        if (!Object.keys(annualData).length && !Object.keys(monthlyHighWeeksData).length && !Object.keys(aggregatedMonthlyData).length) { 
            setViewStatus(`Aucune donnée pertinente pour l'analyse après traitement.`); 
            showViewLoader(false); return; 
        }
        
        renderSummaryTable_ChartsView(annualData); 
        renderMonthlyHighWeeksTable_ChartsView(monthlyHighWeeksData);

        const sortedYearsForAggregated = Object.keys(aggregatedMonthlyData).sort((a,b) => b - a);
        for (const year of sortedYearsForAggregated) {
            const yearAggData = aggregatedMonthlyData[year];
            const monthlyLabels = MONTH_NAMES_FR_CHARTS; 
            const highData = MONTH_NAMES_FR_CHARTS.map((_, i) => yearAggData[String(i + 1).padStart(2, '0')]?.high || 0);
            const lowData = MONTH_NAMES_FR_CHARTS.map((_, i) => yearAggData[String(i + 1).padStart(2, '0')]?.low || 0);

            const yearAggSectionElement = document.createElement('div'); 
            yearAggSectionElement.className = 'aggregated-chart-group'; 
            const yearAggTitleElement = document.createElement('h2');
            yearAggTitleElement.className = 'section-title'; 
            yearAggTitleElement.textContent = `Évolution Mensuelle Globale - Année ${year}`;
            yearAggSectionElement.appendChild(yearAggTitleElement);
            const aggChartsGridContainer = document.createElement('div');
            aggChartsGridContainer.className = 'charts-grid'; 
            yearAggSectionElement.appendChild(aggChartsGridContainer);
            aggregatedMonthlyContainer.appendChild(yearAggSectionElement);

            const addChartCardToAggGrid = (canvasIdBase, cardTitle, keyMetricText, renderFunction, chartDataArgs) => {
                const chartCard = document.createElement('div'); chartCard.className = 'chart-card';
                const titleElement = document.createElement('h3'); titleElement.className = 'chart-section-title';
                titleElement.textContent = cardTitle; chartCard.appendChild(titleElement);
                if (keyMetricText) {
                    const metricElement = document.createElement('p'); metricElement.className = 'chart-key-metric';
                    metricElement.textContent = keyMetricText; chartCard.appendChild(metricElement);
                }
                const chartContainerDiv = document.createElement('div'); chartContainerDiv.className = 'chart-container';
                const canvas = document.createElement('canvas'); const canvasId = `${canvasIdBase}-agg-${year}`;
                canvas.id = canvasId; chartContainerDiv.appendChild(canvas); chartCard.appendChild(chartContainerDiv);
                aggChartsGridContainer.appendChild(chartCard); renderFunction(canvasId, ...chartDataArgs);
            };
            const totalHighThisYearAgg = highData.reduce((a,b) => a+b, 0);
            const totalLowThisYearAgg = lowData.reduce((a,b) => a+b, 0);
            addChartCardToAggGrid(`agg-monthly-bar`, `Semaines Hautes vs Basses (Global)`, 
                `Total Hautes: ${totalHighThisYearAgg} | Total Basses: ${totalLowThisYearAgg}`, 
                renderBarChart, [monthlyLabels, 
                    [{ label: `Semanas > ${HIGH_THRESHOLD_HOURS}h (Global)`, data: highData, backgroundColor: chartColors.danger },
                     { label: `Semanas <= ${LOW_THRESHOLD_HOURS}h (>0h) (Global)`, data: lowData, backgroundColor: chartColors.secondary }]
                ]
            );
        }

        const sortedYearsForPersonCharts = Object.keys(annualData).sort((a, b) => b - a); 
        for (const year of sortedYearsForPersonCharts) {
            const yearDataForDisplay = annualData[year]; 
            const personsInYear = Object.keys(yearDataForDisplay).sort();
            if (personsInYear.length === 0) continue;
            const yearSectionElement = document.createElement('div'); 
            yearSectionElement.className = 'annual-chart-group';
            const yearTitleElement = document.createElement('h2'); 
            yearTitleElement.className = 'section-title'; 
            yearTitleElement.textContent = `Graphiques Détaillés par Personne - Année ${year}`; 
            yearSectionElement.appendChild(yearTitleElement);
            const chartsGridContainer = document.createElement('div'); 
            chartsGridContainer.className = 'charts-grid';
            yearSectionElement.appendChild(chartsGridContainer); 
            chartsAnnualContainer.appendChild(yearSectionElement); 
            
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
                const canvas = document.createElement('canvas'); const canvasId = `${canvasIdBase}-person-${year}`;
                canvas.id = canvasId; chartContainerDiv.appendChild(canvas); chartCard.appendChild(chartContainerDiv);
                chartsGridContainer.appendChild(chartCard); renderFunction(canvasId, ...chartDataArgs);
            };
            const totalHighWeeksThisYear = personsInYear.reduce((sum, p) => sum + (yearDataForDisplay[p]?.high || 0) , 0);
            const totalLowWeeksThisYear = personsInYear.reduce((sum, p) => sum + (yearDataForDisplay[p]?.low || 0), 0);
            addChartCardToGrid(`details-bar`, "Totaux Semaines Hautes & Basses (par personne)", 
                `Hautes (> ${HIGH_THRESHOLD_HOURS}h): ${totalHighWeeksThisYear} | Basses (0 < h ≤ ${LOW_THRESHOLD_HOURS}h): ${totalLowWeeksThisYear}`, 
                renderBarChart, [personsInYear, 
                    [{ label: `Semanas > ${HIGH_THRESHOLD_HOURS}h`, data: personsInYear.map(p => yearDataForDisplay[p]?.high || 0), backgroundColor: chartColors.danger },
                     { label: `Semanas <= ${LOW_THRESHOLD_HOURS}h (>0h)`, data: personsInYear.map(p => yearDataForDisplay[p]?.low || 0), backgroundColor: chartColors.secondary }]
                ]
            );
            const maxConsecutiveHighOverall = Math.max(0, ...personsInYear.map(p => yearDataForDisplay[p]?.maxConsecutiveHigh || 0));
            const maxConsecutiveLowOverall = Math.max(0, ...personsInYear.map(p => yearDataForDisplay[p]?.maxConsecutiveLow || 0));
            addChartCardToGrid(`consecutive-bar`, "Plus Longues Séries Consécutives (par personne)", 
                `Max Hautes: ${maxConsecutiveHighOverall} sem. | Max Basses: ${maxConsecutiveLowOverall} sem.`, 
                renderBarChart, [personsInYear, 
                    [{ label: `Max. Sem. Hautes Cons.`, data: personsInYear.map(p => yearDataForDisplay[p]?.maxConsecutiveHigh || 0), backgroundColor: chartColors.accent },
                     { label: `Max. Sem. Basses Cons.`, data: personsInYear.map(p => yearDataForDisplay[p]?.maxConsecutiveLow || 0), backgroundColor: chartColors.purpleSoft }]
                ]
            );
            let totalActiveWeeksAcrossPersons = personsInYear.reduce((sum, p) => sum + (yearDataForDisplay[p]?.totalActiveWeeks || 0), 0);
            const otherWeeksCount = totalActiveWeeksAcrossPersons - totalHighWeeksThisYear - totalLowWeeksThisYear;
            if (totalActiveWeeksAcrossPersons > 0) {
                let pieLabels = [`Hautes (> ${HIGH_THRESHOLD_HOURS}h)`, `Basses (0 < h ≤ ${LOW_THRESHOLD_HOURS}h)`];
                let pieData = [totalHighWeeksThisYear, totalLowWeeksThisYear];
                if (otherWeeksCount > 0) { pieLabels.push(`Autres Semaines Actives`); pieData.push(otherWeeksCount); }
                addChartCardToGrid(`overall-pie`, `Répartition Globale des Semaines Actives (par personne)`, 
                    `Total semaines actives: ${totalActiveWeeksAcrossPersons}`, 
                    renderPieChart, [pieLabels, pieData], true 
                );
            }
        }
        setViewStatus(`Analyses graphiques et tabulaires générées.`, "success");
    } catch (error) { 
        console.error("Erreur majeure (loadAndProcessData_ChartsView):", error); 
        setViewStatus(`Erreur: ${error.message}`, "error");
    } finally { 
        showViewLoader(false); 
    }
}

// --- Fonctions de Rendu HTML (Tableaux et Graphiques) ---
function renderSummaryTable_ChartsView(annualData) {
    const container = document.getElementById('chartsSummaryTableContainer');
    if (!container) { console.error("#chartsSummaryTableContainer non trouvé."); return; }
    // Le titre H2 est supposé être dans le HTML statique de la <section> parente
    container.innerHTML = ''; 
    const allPersons = new Set(); const allYears = new Set();
    Object.keys(annualData).forEach(year => { 
        allYears.add(year); 
        Object.keys(annualData[year]).forEach(person => { allPersons.add(person); }); 
    });
    if (allPersons.size === 0 || allYears.size === 0) { 
        container.innerHTML = "<p>Pas de données pour le tableau récapitulatif annuel.</p>"; return; 
    }
    const sortedPersons = Array.from(allPersons).sort(); 
    const sortedYears = Array.from(allYears).sort((a,b) => b-a); 
    const table = document.createElement('table'); 
    table.id = 'summaryAnnualHoursTable'; table.className = 'table'; 
    const thead = table.createTHead(); const headerRow = thead.insertRow();
    const thPerson = document.createElement('th'); thPerson.textContent = 'Personne'; headerRow.appendChild(thPerson);
    sortedYears.forEach(year => { 
        const thYear = document.createElement('th'); 
        thYear.innerHTML = `${year}<br>(<span class="high-weeks">H</span>/<span class="low-weeks">B</span>)`; 
        headerRow.appendChild(thYear); 
    });
    const tbody = table.createTBody();
    sortedPersons.forEach(person => {
        const row = tbody.insertRow(); row.insertCell().textContent = person;
        sortedYears.forEach(year => {
            const cell = row.insertCell(); const data = annualData[year]?.[person];
            cell.innerHTML = data ? `<span class="high-weeks">${data.high||0}</span>/<span class="low-weeks">${data.low||0}</span>` : `<span class="no-data-cell">-/-</span>`;
        });
    });
    container.appendChild(table);
}

function renderMonthlyHighWeeksTable_ChartsView(monthlyData) {
    const container = document.getElementById('chartsMonthlyHighWeeksContainer');
    if (!container) { console.error("#chartsMonthlyHighWeeksContainer non trouvé."); return; }
    container.innerHTML = ''; 
    const mainTitle = document.createElement('h2');
    mainTitle.textContent = `Détail Mensuel des Semaines > ${HIGH_THRESHOLD_HOURS}h (par personne)`;
    mainTitle.className = "section-title"; 
    container.appendChild(mainTitle);
    const sortedYears = Object.keys(monthlyData).sort((a, b) => b - a); 
    if (sortedYears.length === 0) {
        container.appendChild(document.createElement('p')).textContent = `Aucune semaine > ${HIGH_THRESHOLD_HOURS}h enregistrée pour détail mensuel.`;
        return;
    }
    let foundDataForDisplay = false;
    for (const year of sortedYears) {
        const yearData = monthlyData[year];
        const sortedPersons = Object.keys(yearData).sort();
        for (const person of sortedPersons) {
            const personMonthlyData = yearData[person];
            const monthsWithData = Object.keys(personMonthlyData).filter(m => personMonthlyData[m] > 0);
            if (monthsWithData.length === 0) continue; 
            foundDataForDisplay = true;
            const personTableTitle = document.createElement('h3');
            personTableTitle.textContent = `${person} - ${year}`;
            personTableTitle.className = "person-year-title"; 
            container.appendChild(personTableTitle);
            const table = document.createElement('table');
            table.className = 'table monthly-summary-table'; 
            const thead = table.createTHead(); const headerRow = thead.insertRow();
            headerRow.insertCell().textContent = 'Mois';
            headerRow.insertCell().textContent = `Nb. Sem. > ${HIGH_THRESHOLD_HOURS}h`;
            const tbody = table.createTBody();
            MONTH_NAMES_FR_CHARTS.forEach((monthName, m_idx) => {
                const monthKey = String(m_idx + 1).padStart(2, '0');
                if (personMonthlyData[monthKey] > 0) {
                    const row = tbody.insertRow();
                    row.insertCell().textContent = monthName;
                    row.insertCell().textContent = personMonthlyData[monthKey];
                    row.cells[1].style.textAlign = 'center';
                }
            });
            container.appendChild(table);
        }
    }
    if (!foundDataForDisplay) {
        container.appendChild(document.createElement('p')).textContent = `Aucune donnée de semaine > ${HIGH_THRESHOLD_HOURS}h à afficher par personne/mois.`;
    }
}

function renderBarChart(canvasId, labels, datasetsConfig, titleTextInternal = null) { 
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { console.error(`Canvas ${canvasId} (BarChart) non trouvé`); return; }
    const ctx = chartCanvas.getContext('2d');
    let maxYValue = 0;
    datasetsConfig.forEach(ds => ds.data.forEach(val => { if ((val||0) > maxYValue) maxYValue = (val||0); }));
    const stepSize = Math.max(1, Math.ceil(maxYValue / 5)); 
    activeChartInstances.push(new Chart(ctx, {
        type: 'bar', data: { labels, datasets: datasetsConfig.map(ds => ({ ...ds, borderWidth:0, borderRadius:{topLeft:4,topRight:4}, barPercentage:0.7, categoryPercentage:0.8 })) },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { title: { display:!!titleTextInternal, text:titleTextInternal||'', font:{family:getCssVariableValue('--font-family-headings','Poppins'),size:13}, color:getCssVariableValue('--text-primary','#2E3440'), padding:{bottom:5} },
                       legend: { position:'bottom', align:'start', labels:{padding:15, font:{family:getCssVariableValue('--font-family-main','Inter'),size:11}, color:getCssVariableValue('--text-secondary','#4C566A'), usePointStyle:true, pointStyle:'rectRounded'} },
                       tooltip: { mode:'index', intersect:false, backgroundColor:'rgba(46,52,64,0.9)', titleFont:{family:getCssVariableValue('--font-family-headings','Poppins'),size:12,weight:'600'}, bodyFont:{family:getCssVariableValue('--font-family-main','Inter'),size:11}, padding:10, cornerRadius:4, boxPadding:4, titleMarginBottom:6, bodySpacing:4 } },
            scales: { y:{beginAtZero:true, ticks:{stepSize, precision:0, font:{family:getCssVariableValue('--font-family-main','Inter'),size:10}, color:getCssVariableValue('--text-secondary','#4C566A'),padding:6}, grid:{drawBorder:false,color:getCssVariableValue('--border-color','rgba(76,86,106,0.15)'),borderDash:[2,4]} },
                      x:{ticks:{font:{family:getCssVariableValue('--font-family-main','Inter'),size:10}, color:getCssVariableValue('--text-secondary','#4C566A'),padding:6}, grid:{display:false}} },
            layout: {padding:{top:5,left:0,right:0,bottom:0}}
        }
    }));
}

function renderPieChart(canvasId, labels, dataValues, titleTextInternal = null) { 
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { console.error(`Canvas ${canvasId} (PieChart) non trouvé`); return; }
    const ctx = chartCanvas.getContext('2d');
    const cardBgColor = getCssVariableValue('--bg-card', '#e5e9f0'); 
    activeChartInstances.push(new Chart(ctx, {
        type:'doughnut', data:{labels, datasets:[{label:'Répartition', data:dataValues, backgroundColor:chartColors.pieColorsArray.slice(0,dataValues.length), borderColor:cardBgColor, borderWidth:2.5, hoverOffset:10, hoverBorderColor:cardBgColor}]},
        options: { responsive:true, maintainAspectRatio:false, cutout:'60%',
            plugins: { title:{display:!!titleTextInternal, text:titleTextInternal||'', font:{family:getCssVariableValue('--font-family-headings','Poppins')}, color:getCssVariableValue('--text-primary','#2E3440'), padding:{bottom:5}},
                       legend:{position:'bottom', align:'center', labels:{padding:15, font:{family:getCssVariableValue('--font-family-main','Inter'),size:11}, color:getCssVariableValue('--text-secondary','#4C566A'), usePointStyle:true, pointStyle:'circle',boxWidth:10,boxHeight:10}},
                       tooltip:{backgroundColor:'rgba(46,52,64,0.9)', titleFont:{family:getCssVariableValue('--font-family-headings','Poppins'),size:12,weight:'600'}, bodyFont:{family:getCssVariableValue('--font-family-main','Inter'),size:11}, padding:10, cornerRadius:4, boxPadding:4, titleMarginBottom:6, bodySpacing:4,
                           callbacks: {label: (c) => `${c.label||''}: ${c.parsed||0} sem. (${(c.parsed / c.dataset.data.reduce((a,v)=>a+v,0)*100).toFixed(1)}%)`}
                       }
            },
            layout:{padding:15}
        }
    }));
}
