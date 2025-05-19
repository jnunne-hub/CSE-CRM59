import { db, showViewLoader, setViewStatus } from '../script.js';

const HIGH_THRESHOLD_HOURS = 35;
const LOW_THRESHOLD_HOURS = 35; // Semaines basses seront < ce seuil (et > 0)

let activeChartInstances = []; // Stocker toutes les instances de graphiques actifs sur la page

export function initChartsView() {
    console.log("Initialisation de la vue Charts");
    const refreshButton = document.getElementById('refreshButtonChart');
    if (refreshButton) refreshButton.addEventListener('click', loadAndProcessData_ChartsView);
    
    if (typeof Chart === 'undefined') {
        setViewStatus("Chart.js n'est pas chargé.");
        return;
    }
    loadAndProcessData_ChartsView();
}

export function cleanupChartsView() {
    activeChartInstances.forEach(chart => chart.destroy());
    activeChartInstances = [];
    console.log("Toutes les instances de graphiques ont été détruites.");
}

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
        const querySnapshot = await db.collection("heuresTravail").orderBy("semaine", "asc").get();
        if (querySnapshot.empty) {
            setViewStatus('Aucune donnée Firebase trouvée.');
            showViewLoader(false);
            return;
        }

        // Structure pour stocker les données agrégées :
        // { annee: { personne: { high: count, low: count, totalWeeks: count }, ... }, ... }
        const annualData = {};

        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.personne || typeof data.heures !== 'number' || !data.semaine) return;

            const year = data.semaine.substring(0, 4); // Extrait l'année de "YYYY-WXX"
            const hours = data.heures;

            if (!annualData[year]) {
                annualData[year] = {};
            }
            if (!annualData[year][data.personne]) {
                annualData[year][data.personne] = { high: 0, low: 0, totalActiveWeeks: 0 };
            }

            annualData[year][data.personne].totalActiveWeeks++;
            if (hours > HIGH_THRESHOLD_HOURS) {
                annualData[year][data.personne].high++;
            } else if (hours > 0 && hours < LOW_THRESHOLD_HOURS) { // Semaine basse si < seuil ET heures > 0
                annualData[year][data.personne].low++;
            }
        });

        if (Object.keys(annualData).length === 0) {
            setViewStatus(`Aucune donnée exploitable pour l'analyse annuelle.`);
            showViewLoader(false);
            return;
        }

        const sortedYears = Object.keys(annualData).sort((a, b) => b - a); // Plus récent en premier

        for (const year of sortedYears) {
            const yearData = annualData[year];
            const personsInYear = Object.keys(yearData).sort();

            if (personsInYear.length === 0) continue;

            // Créer un conteneur pour cette année
            const yearGroupDiv = document.createElement('div');
            yearGroupDiv.className = 'annual-chart-group';
            yearGroupDiv.innerHTML = `<h2>Année ${year}</h2>`;
            chartsAnnualContainer.appendChild(yearGroupDiv);

            // --- Graphique 1: Détail par personne (semaines hautes/basses) ---
            const detailChartContainer = document.createElement('div');
            detailChartContainer.className = 'chart-container';
            const detailCanvasId = `chart-${year}-details`;
            detailChartContainer.innerHTML = `<canvas id="${detailCanvasId}"></canvas>`;
            yearGroupDiv.appendChild(detailChartContainer);

            const labels = personsInYear;
            const highWeekData = personsInYear.map(p => yearData[p].high);
            const lowWeekData = personsInYear.map(p => yearData[p].low);

            renderBarChart(
                detailCanvasId,
                labels,
                [
                    { label: `Semanas > ${HIGH_THRESHOLD_HOURS}h`, data: highWeekData, backgroundColor: 'rgba(255, 99, 132, 0.6)' }, // Rouge
                    { label: `Semanas < ${LOW_THRESHOLD_HOURS}h (>0h)`, data: lowWeekData, backgroundColor: 'rgba(54, 162, 235, 0.6)' }  // Bleu
                ],
                `Détail Semaines Hautes/Basses - ${year}`
            );

            // --- Graphique 2 (Optionnel): Taux de semaines hautes/basses pour l'année (Pie Chart) ---
            // Calculer le total des semaines hautes, basses et "normales" pour l'année entière
            let totalHighWeeksYear = 0;
            let totalLowWeeksYear = 0;
            let totalActiveWeeksYear = 0;
            personsInYear.forEach(person => {
                totalHighWeeksYear += yearData[person].high;
                totalLowWeeksYear += yearData[person].low;
                totalActiveWeeksYear += yearData[person].totalActiveWeeks;
            });
            const totalNormalWeeksYear = totalActiveWeeksYear - totalHighWeeksYear - totalLowWeeksYear;

            if (totalActiveWeeksYear > 0) {
                const overallChartContainer = document.createElement('div');
                overallChartContainer.className = 'chart-container';
                overallChartContainer.style.height = "40vh"; // Pie charts can be smaller
                const overallCanvasId = `chart-${year}-overall-pie`;
                overallChartContainer.innerHTML = `<canvas id="${overallCanvasId}"></canvas>`;
                yearGroupDiv.appendChild(overallChartContainer);

                renderPieChart(
                    overallCanvasId,
                    ['Semaines Hautes', 'Semaines Basses', 'Semaines Normales'],
                    [totalHighWeeksYear, totalLowWeeksYear, totalNormalWeeksYear],
                    `Répartition des Semaines - ${year} (Total)`
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

function renderBarChart(canvasId, labels, datasetsConfig, title) {
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { console.error(`Canvas ${canvasId} non trouvé`); return; }
    
    const ctx = chartCanvas.getContext('2d');
    const newChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasetsConfig.map(ds => ({
                label: ds.label,
                data: ds.data,
                backgroundColor: ds.backgroundColor,
                borderColor: ds.borderColor || ds.backgroundColor.replace('0.6', '1'), // Opacité complète pour la bordure
                borderWidth: 1
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: title, font: { size: 16 } },
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

function renderPieChart(canvasId, labels, dataValues, title) {
    const chartCanvas = document.getElementById(canvasId);
    if (!chartCanvas) { console.error(`Canvas ${canvasId} non trouvé`); return; }

    const ctx = chartCanvas.getContext('2d');
    const newChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                label: 'Répartition des Semaines',
                data: dataValues,
                backgroundColor: [
                    'rgba(255, 99, 132, 0.7)', // Hautes (Rouge)
                    'rgba(54, 162, 235, 0.7)',  // Basses (Bleu)
                    'rgba(75, 192, 192, 0.7)'   // Normales (Vert)
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
                title: { display: true, text: title, font: {size: 16}},
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += context.parsed + ' semaine(s)';
                            }
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
