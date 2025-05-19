// views/charts.js

import { db, showViewLoader, setViewStatus } from '../script.js';

const HIGH_THRESHOLD_HOURS = 35;
const LOW_THRESHOLD_HOURS = 35; // Semaines basses seront < ce seuil (et > 0)

let activeChartInstances = []; // Stocker toutes les instances de graphiques actifs sur la page

// Fonctions spinner (similaires à votre reportGenerator.js)
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
    
    if (typeof Chart === 'undefined') {
        setViewStatus("Chart.js n'est pas chargé.");
        return;
    }
    // Vérifier jsPDF et html2canvas
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
        console.warn("jsPDF ou html2canvas n'est pas chargé. L'export PDF ne fonctionnera pas.");
        if(exportPdfButton) exportPdfButton.disabled = true;
    }
    loadAndProcessData_ChartsView();
}

export function cleanupChartsView() {
    activeChartInstances.forEach(chart => chart.destroy());
    activeChartInstances = [];
    console.log("Toutes les instances de graphiques ont été détruites.");
}

async function exportChartsViewToPdfWithJsPDF() {
    const exportButton = document.getElementById('exportChartsToPdfButton');
    if (typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
        alert("Les librairies jsPDF ou html2canvas ne sont pas chargées.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    
    setViewStatus("Génération du PDF en cours...");
    if (exportButton) exportButton.disabled = true;
    showPdfSpinner(); // Utiliser votre spinner

    const originalChartDefaultsAnimation = Chart.defaults.animation;
    Chart.defaults.animation = false; // Désactiver les animations pour la capture

    const PAGE_MARGIN = 15;
    let currentY = PAGE_MARGIN;
    const pageWidth = doc.internal.pageSize.getWidth();
    const usableWidth = pageWidth - (2 * PAGE_MARGIN);
    let pageAdded = false;

    // Fonction pour ajouter une nouvelle page si nécessaire
    function checkAndAddPage(neededHeight = 30) {
        if (currentY + neededHeight > doc.internal.pageSize.getHeight() - PAGE_MARGIN) {
            doc.addPage();
            currentY = PAGE_MARGIN;
            pageAdded = true;
            return true;
        }
        pageAdded = false;
        return false;
    }

    try {
        // Titre principal du document PDF
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.text("Analyse Détaillée des Heures de Travail", pageWidth / 2, currentY, { align: 'center' });
        currentY += 15;

        // Itérer sur chaque groupe annuel de graphiques
        const annualGroups = document.querySelectorAll('#charts-annual-summary-container .annual-chart-group');

        for (const group of annualGroups) {
            if (pageAdded) { // Si une page a été ajoutée juste avant, on n'a pas besoin de vérifier l'espace pour le titre de l'année
                 // Mais il faut s'assurer que currentY est bien au début de la page.
            } else {
                checkAndAddPage(20); // Espace pour le titre de l'année
            }

            const yearTitleElement = group.querySelector('.year-title');
            if (yearTitleElement) {
                doc.setFontSize(16);
                doc.setFont("helvetica", "bold");
                doc.text(yearTitleElement.textContent, PAGE_MARGIN, currentY);
                currentY += 8;
            }

            const chartSections = group.querySelectorAll('.chart-section');
            for (const section of chartSections) {
                checkAndAddPage(15); // Espace pour le titre de section

                const sectionTitleElement = section.querySelector('.chart-section-title');
                if (sectionTitleElement) {
                    doc.setFontSize(12);
                    doc.setFont("helvetica", "italic");
                    doc.text(sectionTitleElement.textContent, PAGE_MARGIN, currentY);
                    currentY += 7;
                }

                const canvasElement = section.querySelector('canvas');
                if (canvasElement) {
                    // S'assurer que le graphique est bien dessiné (surtout si on vient de le créer)
                    const chartInstance = activeChartInstances.find(c => c.canvas === canvasElement);
                    if (chartInstance) {
                         // chartInstance.update('none'); // S'assurer qu'il est rendu sans animation
                    }
                    await new Promise(resolve => setTimeout(resolve, 150)); // Petite pause pour le rendu

                    try {
                        const canvasImg = await html2canvas(canvasElement, { 
                            scale: 2, 
                            backgroundColor: '#ffffff', // Fond blanc pour la capture
                            logging: false,
                            useCORS: true // Important si les graphiques utilisent des images/polices externes (peu probable ici)
                        });
                        const imgData = canvasImg.toDataURL('image/png'); // Utiliser PNG pour meilleure qualité des graphiques
                        
                        const imgProps = doc.getImageProperties(imgData);
                        let imgHeight = (imgProps.height * usableWidth) / imgProps.width;
                        let imgWidth = usableWidth;

                        // Ajuster si l'image est trop haute pour la page
                        const maxHeightOnPage = doc.internal.pageSize.getHeight() - currentY - PAGE_MARGIN;
                        if (imgHeight > maxHeightOnPage && maxHeightOnPage > 30) { // Si l'image est trop haute mais qu'on a de la place
                            imgHeight = maxHeightOnPage;
                            imgWidth = (imgProps.width * imgHeight) / imgProps.height; // Recalculer la largeur pour garder l'aspect ratio
                        }

                        checkAndAddPage(imgHeight + 5); // Espace pour l'image + petite marge
                        
                        const imgX = (pageWidth - imgWidth) / 2; // Centrer l'image
                        doc.addImage(imgData, 'PNG', imgX, currentY, imgWidth, imgHeight);
                        currentY += imgHeight + 7; // Marge après l'image
                    } catch(e) {
                        console.error("Erreur lors de la capture du canvas:", canvasElement.id, e);
                        doc.setTextColor(255,0,0);
                        doc.text("Erreur de capture du graphique.", PAGE_MARGIN, currentY);
                        doc.setTextColor(0,0,0);
                        currentY += 7;
                    }
                }
            }
            currentY += 5; // Espace entre les groupes annuels
        }

        doc.save('analyse_graphiques_heures.pdf');
        setViewStatus("PDF des graphiques généré et téléchargé.");

    } catch (error) {
        console.error("Erreur globale lors de la génération du PDF avec jsPDF:", error);
        setViewStatus("Erreur lors de la génération du PDF.");
    } finally {
        Chart.defaults.animation = originalChartDefaultsAnimation; // Restaurer
        if (exportButton) exportButton.disabled = false;
        hidePdfSpinner(); // Utiliser votre spinner
    }
}


// --- Le reste du fichier (loadAndProcessData_ChartsView, createChartSubSection, renderBarChart, renderPieChart) ---
// ... reste identique à la version précédente ...
async function loadAndProcessData_ChartsView() {
    if (!db) { setViewStatus("Firebase non initialisé."); return; }
    if (typeof Chart === 'undefined') { setViewStatus("Chart.js non chargé."); return; }

    showViewLoader(true);
    setViewStatus('Chargement et traitement des données pour les graphiques annuels...');
    cleanupChartsView(); // Nettoyer les graphiques précédents

    const chartsAnnualContainer = document.getElementById('charts-annual-summary-container');
    if (!chartsAnnualContainer) {
        console.error("Conteneur #charts-annual-summary-container non trouvé.");
        showViewLoader(false);
        return;
    }
    chartsAnnualContainer.innerHTML = ''; // Vider les anciens graphiques

    try {
        const querySnapshot = await db.collection("heuresTravail").orderBy("personne").orderBy("semaine", "asc").get();
        if (querySnapshot.empty) {
            setViewStatus('Aucune donnée Firebase trouvée.');
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
                    weeklyHours: {},
                    maxConsecutiveHigh: 0, 
                    maxConsecutiveLow: 0 
                };
            }
            if (!personWeeklyData[data.personne]) {
                personWeeklyData[data.personne] = {};
            }

            annualData[year][data.personne].totalActiveWeeks++;
            annualData[year][data.personne].weeklyHours[data.semaine] = hours;
            if (hours > HIGH_THRESHOLD_HOURS) {
                annualData[year][data.personne].high++;
            } else if (hours > 0 && hours < LOW_THRESHOLD_HOURS) {
                annualData[year][data.personne].low++;
            }
            
            personWeeklyData[data.personne][data.semaine] = hours;
        });
        
        for (const person in personWeeklyData) {
            const weeksForPerson = Object.keys(personWeeklyData[person]).sort();
            let currentConsecutiveHigh = 0;
            let currentConsecutiveLow = 0;
            let lastYearProcessed = "";

            for (const week of weeksForPerson) {
                const year = week.substring(0, 4);
                const hours = personWeeklyData[person][week];

                if (year !== lastYearProcessed && lastYearProcessed !== "") {
                    if (annualData[lastYearProcessed] && annualData[lastYearProcessed][person]) {
                        annualData[lastYearProcessed][person].maxConsecutiveHigh = Math.max(annualData[lastYearProcessed][person].maxConsecutiveHigh, currentConsecutiveHigh);
                        annualData[lastYearProcessed][person].maxConsecutiveLow = Math.max(annualData[lastYearProcessed][person].maxConsecutiveLow, currentConsecutiveLow);
                    }
                    currentConsecutiveHigh = 0;
                    currentConsecutiveLow = 0;
                }
                lastYearProcessed = year;

                if (hours > HIGH_THRESHOLD_HOURS) {
                    currentConsecutiveHigh++; currentConsecutiveLow = 0;
                } else if (hours > 0 && hours < LOW_THRESHOLD_HOURS) {
                    currentConsecutiveLow++; currentConsecutiveHigh = 0;
                } else {
                    currentConsecutiveHigh = 0; currentConsecutiveLow = 0;
                }
                if (annualData[year] && annualData[year][person]) {
                    annualData[year][person].maxConsecutiveHigh = Math.max(annualData[year][person].maxConsecutiveHigh, currentConsecutiveHigh);
                    annualData[year][person].maxConsecutiveLow = Math.max(annualData[year][person].maxConsecutiveLow, currentConsecutiveLow);
                }
            }
            if (lastYearProcessed !== "" && annualData[lastYearProcessed] && annualData[lastYearProcessed][person]) {
                annualData[lastYearProcessed][person].maxConsecutiveHigh = Math.max(annualData[lastYearProcessed][person].maxConsecutiveHigh, currentConsecutiveHigh);
                annualData[lastYearProcessed][person].maxConsecutiveLow = Math.max(annualData[lastYearProcessed][person].maxConsecutiveLow, currentConsecutiveLow);
            }
        }

        if (Object.keys(annualData).length === 0) {
            setViewStatus(`Aucune donnée exploitable pour l'analyse annuelle.`);
            showViewLoader(false); 
            return;
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
            
            chartsAnnualContainer.appendChild(yearSectionElement); 

            const detailSection = createChartSubSection(
                `chart-${year}-details`, 
                "Totaux Semaines Hautes et Basses par Personne"
            );
            yearSectionElement.appendChild(detailSection.section);
            renderBarChart(
                detailSection.canvasId, personsInYear,
                [
                    { label: `Semaine > ${HIGH_THRESHOLD_HOURS}h`, data: personsInYear.map(p => yearDataForDisplay[p].high), backgroundColor: 'rgba(255, 99, 132, 0.6)' },
                    { label: `Semaine < ${LOW_THRESHOLD_HOURS}h (>0h)`, data: personsInYear.map(p => yearDataForDisplay[p].low), backgroundColor: 'rgba(54, 162, 235, 0.6)' }
                ],
                null 
            );

            const consecutiveSection = createChartSubSection(
                `chart-${year}-consecutive`,
                "Plus Longues Séries Consécutives (Hautes/Basses) par Personne"
            );
            yearSectionElement.appendChild(consecutiveSection.section);
            renderBarChart(
                consecutiveSection.canvasId, personsInYear,
                [
                    { label: `Max. Sem. Hautes Consécutives`, data: personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveHigh), backgroundColor: 'rgba(255, 159, 64, 0.6)' },
                    { label: `Max. Sem. Basses Consécutives`, data: personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveLow), backgroundColor: 'rgba(153, 102, 255, 0.6)' }
                ],
                null
            );

            let totalHigh = 0, totalLow = 0, totalActive = 0;
            personsInYear.forEach(p => { 
                totalHigh += yearDataForDisplay[p].high; 
                totalLow += yearDataForDisplay[p].low; 
                totalActive += yearDataForDisplay[p].totalActiveWeeks; 
            });
            const totalNormal = totalActive - totalHigh - totalLow;

            if (totalActive > 0) {
                const overallPieSection = createChartSubSection(
                    `chart-${year}-overall-pie`,
                    `Répartition Globale des Semaines pour l'Année ${year}`
                );
                overallPieSection.chartContainer.style.height = "40vh";
                yearSectionElement.appendChild(overallPieSection.section);
                renderPieChart(
                    overallPieSection.canvasId,
                    ['Semaines Hautes', 'Semaines Basses', 'Semaines Normales'],
                    [totalHigh, totalLow, totalNormal],
                    null
                );
            }
        }
        setViewStatus(`Graphiques annuels générés.`);

    } catch (error) {
        console.error("Erreur Firebase/Chart (ChartsView):", error);
        setViewStatus(`Erreur: ${error.message}`);
    } finally {
        showViewLoader(false);
    }
}

function createChartSubSection(canvasBaseId, sectionTitleText) {
    const section = document.createElement('div');
    section.className = 'chart-section';

    const title = document.createElement('h3');
    title.className = 'chart-section-title';
    title.textContent = sectionTitleText;
    section.appendChild(title);

    const chartContainer = document.createElement('div');
    chartContainer.className = 'chart-container';
    const canvas = document.createElement('canvas');
    canvas.id = canvasBaseId;
    chartContainer.appendChild(canvas);
    section.appendChild(chartContainer);

    return { section, canvasId: canvasBaseId, chartContainer };
}

function renderBarChart(canvasId, labels, datasetsConfig, titleText) {
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { 
        console.error(`Canvas ${canvasId} non trouvé pour renderBarChart`); 
        return; 
    }
    
    const ctx = chartCanvas.getContext('2d');
    const newChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasetsConfig.map(ds => ({
                label: ds.label,
                data: ds.data,
                backgroundColor: ds.backgroundColor,
                borderColor: ds.borderColor || ds.backgroundColor.replace('0.6', '1'),
                borderWidth: 1
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: !!titleText, text: titleText || '', font: { size: 16 } },
                legend: { position: 'top' },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Nombre de Semaines' }, ticks: { stepSize: 1, precision: 0 } },
                x: { title: { display: true, text: 'Personne' } }
            }
        }
    });
    activeChartInstances.push(newChart);
}

function renderPieChart(canvasId, labels, dataValues, titleText) {
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { 
        console.error(`Canvas ${canvasId} non trouvé pour renderPieChart`); 
        return; 
    }

    const ctx = chartCanvas.getContext('2d');
    const newChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                label: 'Répartition des Semaines',
                data: dataValues,
                backgroundColor: [
                    'rgba(255, 99, 132, 0.7)', 
                    'rgba(54, 162, 235, 0.7)',  
                    'rgba(75, 192, 192, 0.7)'   
                ],
                borderColor: [
                    'rgba(255, 99, 132, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(75, 192, 192, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: !!titleText, text: titleText || '', font: {size: 16}},
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) label += ': ';
                            if (context.parsed !== null) label += context.parsed + ' semaine(s)';
                            const total = context.dataset.data.reduce((acc, val) => acc + val, 0);
                            const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) + '%' : '0%';
                            label += ` (${percentage})`;
                            return label;
                        }
                    }
                }
            }
        }
    });
    activeChartInstances.push(newChart);
}
