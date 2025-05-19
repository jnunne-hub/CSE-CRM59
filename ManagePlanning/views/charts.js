// views/charts.js

import { db, showViewLoader, setViewStatus } from '../script.js';

const HIGH_THRESHOLD_HOURS = 35;
const LOW_THRESHOLD_HOURS = 35; // Semaines basses seront < ce seuil (et > 0)

let activeChartInstances = []; // Stocker toutes les instances de graphiques actifs sur la page

// Fonctions spinner (similaires à votre reportGenerator.js si vous l'utilisez, sinon définissez-les ici)
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
    if (exportPdfButton) exportPdfButton.addEventListener('click', exportChartsViewToPdfWithJsPDF); // Utilisation de la fonction d'export jsPDF
    
    if (typeof Chart === 'undefined') {
        setViewStatus("Chart.js n'est pas chargé.");
        return;
    }
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') { // Vérifier jsPDF pour l'export
        console.warn("jsPDF ou html2canvas n'est pas chargé. L'export PDF via jsPDF ne fonctionnera pas.");
        if(exportPdfButton) exportPdfButton.disabled = true;
    }
    loadAndProcessData_ChartsView();
}

export function cleanupChartsView() {
    activeChartInstances.forEach(chart => chart.destroy());
    activeChartInstances = [];
    console.log("Toutes les instances de graphiques ont été détruites.");
}

async function exportChartsViewToPdfWithJsPDF() { // Renommée pour clarté
    const exportButton = document.getElementById('exportChartsToPdfButton');
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
        alert("Les librairies jsPDF ou html2canvas ne sont pas chargées.");
        return;
    }

    const { jsPDF } = window.jspdf; // Assurez-vous que cela est correct
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    
    setViewStatus("Génération du PDF en cours...");
    if (exportButton) exportButton.disabled = true;
    showPdfSpinner();

    const originalChartDefaultsAnimation = Chart.defaults.animation;
    Chart.defaults.animation = false;

    const PAGE_MARGIN = 15;
    let currentY = PAGE_MARGIN;
    const pageWidth = doc.internal.pageSize.getWidth();
    const usableWidth = pageWidth - (2 * PAGE_MARGIN);
    let pageAdded = false;

    function checkAndAddPage(neededHeight = 30) {
        if (currentY + neededHeight > doc.internal.pageSize.getHeight() - PAGE_MARGIN) {
            doc.addPage();
            currentY = PAGE_MARGIN;
            pageAdded = true; // Indiquer qu'une nouvelle page a été ajoutée
            return true;
        }
        pageAdded = false;
        return false;
    }

    try {
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        const mainTitle = "Analyse Détaillée des Heures de Travail";
        // Gérer le titre sur plusieurs lignes si trop long (rare ici)
        const mainTitleLines = doc.splitTextToSize(mainTitle, usableWidth);
        doc.text(mainTitleLines, pageWidth / 2, currentY, { align: 'center' });
        currentY += (mainTitleLines.length * 7) + 8; // Ajuster en fonction du nombre de lignes du titre + marge

        const annualGroups = document.querySelectorAll('#charts-annual-summary-container .annual-chart-group');

        for (const group of annualGroups) {
            if (!pageAdded) { // Seulement vérifier si currentY est proche du bas de la page si aucune page n'a été ajoutée récemment
                 checkAndAddPage(20); // Espace pour le titre de l'année
            }


            const yearTitleElement = group.querySelector('.year-title');
            if (yearTitleElement) {
                doc.setFontSize(16);
                doc.setFont("helvetica", "bold");
                doc.text(yearTitleElement.textContent, PAGE_MARGIN, currentY);
                currentY += 8;
            }

            const chartCards = group.querySelectorAll('.chart-card'); // Modifier pour cibler les cartes
            for (const card of chartCards) {
                 if (!pageAdded) checkAndAddPage(15); // Espace pour le titre de la carte

                const sectionTitleElement = card.querySelector('.chart-section-title');
                if (sectionTitleElement) {
                    doc.setFontSize(12);
                    doc.setFont("helvetica", "italic"); // Mis en italique pour le distinguer
                    doc.text(sectionTitleElement.textContent, PAGE_MARGIN, currentY);
                    currentY += 7;
                }

                const canvasElement = card.querySelector('canvas');
                if (canvasElement) {
                    await new Promise(resolve => setTimeout(resolve, 200)); // Augmenter un peu l'attente pour le rendu du canvas

                    try {
                        const canvasImg = await html2canvas(canvasElement, { 
                            scale: 2, 
                            backgroundColor: '#ffffff',
                            logging: false,
                            useCORS: true 
                        });
                        const imgData = canvasImg.toDataURL('image/png');
                        
                        const imgProps = doc.getImageProperties(imgData);
                        let imgHeight = (imgProps.height * usableWidth) / imgProps.width;
                        let imgWidth = usableWidth;

                        const maxHeightOnPage = doc.internal.pageSize.getHeight() - currentY - PAGE_MARGIN;
                        if (imgHeight > maxHeightOnPage) { // Si l'image dépasse
                            if (maxHeightOnPage < 30) { // Pas assez de place, nouvelle page
                                doc.addPage(); currentY = PAGE_MARGIN;
                                // Retenter de placer l'image, la hauteur sera recalculée pour la nouvelle page pleine
                                imgHeight = (imgProps.height * usableWidth) / imgProps.width; // Réinitialiser au ratio original
                                if (imgHeight > doc.internal.pageSize.getHeight() - (2*PAGE_MARGIN)) { // Si toujours trop grande pour une page vide
                                    imgHeight = doc.internal.pageSize.getHeight() - (2*PAGE_MARGIN); // Max height
                                }
                            } else { // Essayer de la faire tenir sur la page actuelle
                                 imgHeight = maxHeightOnPage;
                            }
                            imgWidth = (imgProps.width * imgHeight) / imgProps.height;
                        }
                        
                        // Vérifier à nouveau si une nouvelle page est nécessaire APRÈS le redimensionnement final
                        if (currentY + imgHeight + 5 > doc.internal.pageSize.getHeight() - PAGE_MARGIN) {
                             doc.addPage(); currentY = PAGE_MARGIN;
                        }
                        
                        const imgX = (pageWidth - imgWidth) / 2;
                        doc.addImage(imgData, 'PNG', imgX, currentY, imgWidth, imgHeight);
                        currentY += imgHeight + 7;
                    } catch(e) {
                        console.error("Erreur capture canvas:", canvasElement.id, e);
                        if(!pageAdded) checkAndAddPage(7);
                        doc.setTextColor(255,0,0);
                        doc.text("Erreur capture du graphique.", PAGE_MARGIN, currentY);
                        doc.setTextColor(0,0,0);
                        currentY += 7;
                    }
                }
            }
            currentY += 5; 
        }

        doc.save('analyse_graphiques_heures.pdf');
        setViewStatus("PDF des graphiques généré et téléchargé.");

    } catch (error) {
        console.error("Erreur PDF jsPDF:", error);
        setViewStatus("Erreur génération PDF.", "error");
    } finally {
        Chart.defaults.animation = originalChartDefaultsAnimation;
        if (exportButton) exportButton.disabled = false;
        hidePdfSpinner();
    }
}


async function loadAndProcessData_ChartsView() {
    if (!db) { setViewStatus("Firebase non initialisé.", "error"); return; }
    if (typeof Chart === 'undefined') { setViewStatus("Chart.js non chargé.", "error"); return; }

    showViewLoader(true);
    setViewStatus('Chargement des données...');
    cleanupChartsView(); 

    const chartsAnnualContainer = document.getElementById('charts-annual-summary-container');
    if (!chartsAnnualContainer) {
        console.error("Conteneur #charts-annual-summary-container non trouvé.");
        showViewLoader(false);
        return;
    }
    chartsAnnualContainer.innerHTML = '';

    try {
        const querySnapshot = await db.collection("heuresTravail").orderBy("personne").orderBy("semaine", "asc").get();
        if (querySnapshot.empty) {
            setViewStatus('Aucune donnée Firebase.');
            showViewLoader(false);
            return;
        }

        const annualData = {};
        const personWeeklyData = {};

        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.personne || typeof data.heures !== 'number' || !data.semaine) return;
            const year = data.semaine.substring(0, 4);
            const hours = data.heures;

            if (!annualData[year]) annualData[year] = {};
            if (!annualData[year][data.personne]) {
                annualData[year][data.personne] = { 
                    high: 0, low: 0, totalActiveWeeks: 0, 
                    weeklyHours: {}, maxConsecutiveHigh: 0, maxConsecutiveLow: 0 
                };
            }
            if (!personWeeklyData[data.personne]) personWeeklyData[data.personne] = {};

            annualData[year][data.personne].totalActiveWeeks++;
            annualData[year][data.personne].weeklyHours[data.semaine] = hours;
            if (hours > HIGH_THRESHOLD_HOURS) annualData[year][data.personne].high++;
            else if (hours > 0 && hours < LOW_THRESHOLD_HOURS) annualData[year][data.personne].low++;
            personWeeklyData[data.personne][data.semaine] = hours;
        });
        
        for (const person in personWeeklyData) {
            const weeksForPerson = Object.keys(personWeeklyData[person]).sort();
            let currentConsecutiveHigh = 0, currentConsecutiveLow = 0, lastYearProcessed = "";
            for (const week of weeksForPerson) {
                const year = week.substring(0, 4);
                const hours = personWeeklyData[person][week];
                if (year !== lastYearProcessed && lastYearProcessed !== "") {
                    if (annualData[lastYearProcessed]?.[person]) {
                        annualData[lastYearProcessed][person].maxConsecutiveHigh = Math.max(annualData[lastYearProcessed][person].maxConsecutiveHigh, currentConsecutiveHigh);
                        annualData[lastYearProcessed][person].maxConsecutiveLow = Math.max(annualData[lastYearProcessed][person].maxConsecutiveLow, currentConsecutiveLow);
                    }
                    currentConsecutiveHigh = 0; currentConsecutiveLow = 0;
                }
                lastYearProcessed = year;
                if (hours > HIGH_THRESHOLD_HOURS) { currentConsecutiveHigh++; currentConsecutiveLow = 0; } 
                else if (hours > 0 && hours < LOW_THRESHOLD_HOURS) { currentConsecutiveLow++; currentConsecutiveHigh = 0; } 
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

        if (Object.keys(annualData).length === 0) {
            setViewStatus(`Pas de données pour l'analyse annuelle.`);
            showViewLoader(false); return;
        }

        const sortedYears = Object.keys(annualData).sort((a, b) => b - a);
        for (const year of sortedYears) {
            const yearDataForDisplay = annualData[year];
            const personsInYear = Object.keys(yearDataForDisplay).sort();
            if (personsInYear.length === 0) continue;

            const yearSectionElement = document.createElement('section');
            yearSectionElement.className = 'annual-chart-group';
            const yearTitleElement = document.createElement('h2');
            yearTitleElement.className = 'year-title';
            yearTitleElement.textContent = `Analyse pour l'Année ${year}`;
            yearSectionElement.appendChild(yearTitleElement);
            
            const chartsGridContainer = document.createElement('div');
            chartsGridContainer.className = 'charts-grid';
            yearSectionElement.appendChild(chartsGridContainer);
            chartsAnnualContainer.appendChild(yearSectionElement); 

            const addChartCardToGrid = (canvasIdBase, cardTitle, renderFunction, chartDataArgs, isPie = false) => {
                const chartCard = document.createElement('div');
                chartCard.className = 'chart-card';
                if (isPie) chartCard.classList.add('pie-chart-card');
                const titleElement = document.createElement('h3');
                titleElement.className = 'chart-section-title';
                titleElement.textContent = cardTitle;
                chartCard.appendChild(titleElement);
                const chartContainer = document.createElement('div');
                chartContainer.className = 'chart-container';
                const canvas = document.createElement('canvas');
                const canvasId = `${canvasIdBase}-${year}`;
                canvas.id = canvasId;
                chartContainer.appendChild(canvas);
                chartCard.appendChild(chartContainer);
                chartsGridContainer.appendChild(chartCard);
                renderFunction(canvasId, ...chartDataArgs);
            };

            addChartCardToGrid(`details`, "Totaux Semaines Hautes et Basses", renderBarChart,
                [personsInYear,
                    [
                        { label: `Semanas > ${HIGH_THRESHOLD_HOURS}h`, data: personsInYear.map(p => yearDataForDisplay[p].high), backgroundColor: 'rgba(255, 99, 132, 0.7)' },
                        { label: `Semanas < ${LOW_THRESHOLD_HOURS}h (>0h)`, data: personsInYear.map(p => yearDataForDisplay[p].low), backgroundColor: 'rgba(54, 162, 235, 0.7)' }
                    ], null 
                ]
            );
            addChartCardToGrid(`consecutive`, "Plus Longues Séries Consécutives", renderBarChart,
                [personsInYear,
                    [
                        { label: `Max. Sem. Hautes Cons.`, data: personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveHigh), backgroundColor: 'rgba(255, 159, 64, 0.7)' },
                        { label: `Max. Sem. Basses Cons.`, data: personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveLow), backgroundColor: 'rgba(153, 102, 255, 0.7)' }
                    ], null
                ]
            );
            let totalHigh = 0, totalLow = 0, totalActive = 0;
            personsInYear.forEach(p => { 
                totalHigh += yearDataForDisplay[p].high; totalLow += yearDataForDisplay[p].low; totalActive += yearDataForDisplay[p].totalActiveWeeks; 
            });
            const totalNormal = totalActive - totalHigh - totalLow;
            if (totalActive > 0) {
                addChartCardToGrid(`overall-pie`, `Répartition Globale des Semaines (${year})`, renderPieChart,
                    [['Semaines Hautes', 'Semaines Basses', 'Semaines Normales'], [totalHigh, totalLow, totalNormal], null ], true
                );
            }
        }
        setViewStatus(`Graphiques annuels générés.`, "success");
    } catch (error) {
        console.error("Erreur Firebase/Chart (ChartsView):", error);
        setViewStatus(`Erreur: ${error.message}`, "error");
    } finally {
        showViewLoader(false);
    }
}

function renderBarChart(canvasId, labels, datasetsConfig, titleText) {
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { console.error(`Canvas ${canvasId} non trouvé (renderBarChart)`); return; }
    const ctx = chartCanvas.getContext('2d');
    const newChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasetsConfig.map(ds => ({
                label: ds.label, data: ds.data, backgroundColor: ds.backgroundColor,
                borderColor: ds.borderColor || ds.backgroundColor.replace('0.7', '1').replace('0.6', '1'),
                borderWidth: 1, borderRadius: 4,
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: !!titleText, text: titleText || '', font: { size: 14 }, padding: { bottom: 10 } },
                legend: { position: 'bottom', labels: { padding: 15, font: {size: 11} } },
                tooltip: { 
                    mode: 'index', intersect: false, backgroundColor: 'rgba(0,0,0,0.75)',
                    titleFont: {size: 13}, bodyFont: {size: 12}, padding: 10, cornerRadius: 4
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, title: { display: true, text: 'Nombre de Semaines', font:{size: 12} }, 
                    ticks: { stepSize: 1, precision: 0, font:{size: 11} },
                    grid: { drawBorder: false, color: 'rgba(200,200,200,0.3)' }
                },
                x: { 
                    title: { display: false }, ticks: {font:{size: 11}}, grid: { display: false }
                 }
            },
            layout: { padding: { top: 5, bottom: 5 } }
        }
    });
    activeChartInstances.push(newChart);
}

function renderPieChart(canvasId, labels, dataValues, titleText) {
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { console.error(`Canvas ${canvasId} non trouvé (renderPieChart)`); return; }
    const ctx = chartCanvas.getContext('2d');
    const newChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'Répartition', data: dataValues,
                backgroundColor: ['rgba(255, 99, 132, 0.8)', 'rgba(54, 162, 235, 0.8)', 'rgba(75, 192, 192, 0.8)', 'rgba(255, 206, 86, 0.8)', 'rgba(153, 102, 255, 0.8)'],
                borderColor: '#ffffff', borderWidth: 2, hoverOffset: 8
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '50%',
            plugins: {
                title: { display: !!titleText, text: titleText || '', font: {size: 14}, padding: {bottom:10}},
                legend: { position: 'bottom', labels: {padding: 15, font:{size:11}} },
                tooltip: { 
                    backgroundColor: 'rgba(0,0,0,0.75)', titleFont: {size: 13}, bodyFont: {size: 12},
                    padding: 10, cornerRadius: 4,
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) label += ': ';
                            const value = context.parsed;
                            if (value !== null) label += value + ' sem.';
                            const total = context.dataset.data.reduce((acc, val) => acc + val, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%';
                            return `${label} (${percentage})`;
                        }
                    }
                }
            }
        }
    });
    activeChartInstances.push(newChart);
}
