import { db, showViewLoader, setViewStatus } from '../script.js';

const HIGH_THRESHOLD_HOURS = 35;
const LOW_THRESHOLD_HOURS = 35; // Semaines basses seront < ce seuil (et > 0)

let activeChartInstances = [];

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
            setViewStatus('Aucune donnée Firebase trouvée.');
            showViewLoader(false);
            return;
        }

        // Structure pour stocker les données agrégées :
        // { annee: { personne: { high: count, low: count, totalActiveWeeks: count, weeklyHours: {"YYYY-WXX": hours, ...}, maxConsecutiveHigh: 0, maxConsecutiveLow: 0 }, ... }, ... }
        const annualData = {};
        // Structure temporaire pour faciliter le calcul des séries consécutives
        // { personne: { "YYYY-WXX": hours, ... }, ... }
        const personWeeklyData = {};


        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.personne || typeof data.heures !== 'number' || !data.semaine) return;

            const year = data.semaine.substring(0, 4);
            const hours = data.heures;

            // Initialisation des structures
            if (!annualData[year]) annualData[year] = {};
            if (!annualData[year][data.personne]) {
                annualData[year][data.personne] = { 
                    high: 0, low: 0, totalActiveWeeks: 0, 
                    weeklyHours: {}, // Stocker les heures par semaine pour cette personne cette année
                    maxConsecutiveHigh: 0, 
                    maxConsecutiveLow: 0 
                };
            }
            if (!personWeeklyData[data.personne]) {
                personWeeklyData[data.personne] = {};
            }

            // Agrégation simple
            annualData[year][data.personne].totalActiveWeeks++;
            annualData[year][data.personne].weeklyHours[data.semaine] = hours; // Pour analyse consécutive
            if (hours > HIGH_THRESHOLD_HOURS) {
                annualData[year][data.personne].high++;
            } else if (hours > 0 && hours < LOW_THRESHOLD_HOURS) {
                annualData[year][data.personne].low++;
            }
            
            // Stockage pour l'analyse consécutive globale par personne
            personWeeklyData[data.personne][data.semaine] = hours;
        });
        
        // --- Calcul des semaines consécutives ---
        for (const person in personWeeklyData) {
            const weeksForPerson = Object.keys(personWeeklyData[person]).sort(); // Semaines triées pour cette personne
            
            let currentConsecutiveHigh = 0;
            let maxConsecutiveHighOverall = 0;
            let currentConsecutiveLow = 0;
            let maxConsecutiveLowOverall = 0;
            let lastYearProcessed = "";

            for (const week of weeksForPerson) {
                const year = week.substring(0, 4);
                const hours = personWeeklyData[person][week];

                // Réinitialiser pour chaque nouvelle année pour le stockage dans annualData[year][person]
                // Mais continuer le calcul global pour maxConsecutiveHighOverall et maxConsecutiveLowOverall si besoin
                // Ici, nous calculons par année, donc on réinitialise si l'année change.
                if (year !== lastYearProcessed && lastYearProcessed !== "") {
                     // S'assurer que les max de l'année précédente sont bien stockés
                    if (annualData[lastYearProcessed] && annualData[lastYearProcessed][person]) {
                        annualData[lastYearProcessed][person].maxConsecutiveHigh = Math.max(annualData[lastYearProcessed][person].maxConsecutiveHigh, currentConsecutiveHigh);
                        annualData[lastYearProcessed][person].maxConsecutiveLow = Math.max(annualData[lastYearProcessed][person].maxConsecutiveLow, currentConsecutiveLow);
                    }
                    currentConsecutiveHigh = 0;
                    currentConsecutiveLow = 0;
                }
                lastYearProcessed = year;


                // Semaines hautes
                if (hours > HIGH_THRESHOLD_HOURS) {
                    currentConsecutiveHigh++;
                    currentConsecutiveLow = 0; // Rompt la série basse
                } 
                // Semaines basses
                else if (hours > 0 && hours < LOW_THRESHOLD_HOURS) {
                    currentConsecutiveLow++;
                    currentConsecutiveHigh = 0; // Rompt la série haute
                } 
                // Semaines normales ou sans heures (rompt les deux types de séries)
                else {
                    currentConsecutiveHigh = 0;
                    currentConsecutiveLow = 0;
                }
                if (annualData[year] && annualData[year][person]) {
                    annualData[year][person].maxConsecutiveHigh = Math.max(annualData[year][person].maxConsecutiveHigh, currentConsecutiveHigh);
                    annualData[year][person].maxConsecutiveLow = Math.max(annualData[year][person].maxConsecutiveLow, currentConsecutiveLow);
                }
            }
             // S'assurer que les max de la dernière année traitée pour cette personne sont bien stockés
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
            renderBarChart(
                detailCanvasId,
                personsInYear,
                [
                    { label: `Semanas > ${HIGH_THRESHOLD_HOURS}h`, data: personsInYear.map(p => yearDataForDisplay[p].high), backgroundColor: 'rgba(255, 99, 132, 0.6)' },
                    { label: `Semanas < ${LOW_THRESHOLD_HOURS}h (>0h)`, data: personsInYear.map(p => yearDataForDisplay[p].low), backgroundColor: 'rgba(54, 162, 235, 0.6)' }
                ],
                `Total Semaines Hautes/Basses - ${year}`
            );

            // --- Graphique 2: Plus longues séries consécutives hautes/basses par personne ---
            const consecutiveChartContainer = document.createElement('div');
            consecutiveChartContainer.className = 'chart-container';
            const consecutiveCanvasId = `chart-${year}-consecutive`;
            consecutiveChartContainer.innerHTML = `<canvas id="${consecutiveCanvasId}"></canvas>`;
            yearGroupDiv.appendChild(consecutiveChartContainer);
            renderBarChart(
                consecutiveCanvasId,
                personsInYear,
                [
                    { label: `Max. Sem. Hautes Consécutives`, data: personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveHigh), backgroundColor: 'rgba(255, 159, 64, 0.6)' }, // Orange
                    { label: `Max. Sem. Basses Consécutives`, data: personsInYear.map(p => yearDataForDisplay[p].maxConsecutiveLow), backgroundColor: 'rgba(153, 102, 255, 0.6)' } // Violet
                ],
                `Max. Séries Consécutives Hautes/Basses - ${year}`
            );


            // --- Graphique 3 (Optionnel): Taux de semaines hautes/basses pour l'année (Pie Chart) ---
            let totalHighWeeksYear = 0, totalLowWeeksYear = 0, totalActiveWeeksYear = 0;
            personsInYear.forEach(person => {
                totalHighWeeksYear += yearDataForDisplay[person].high;
                totalLowWeeksYear += yearDataForDisplay[person].low;
                totalActiveWeeksYear += yearDataForDisplay[person].totalActiveWeeks;
            });
            const totalNormalWeeksYear = totalActiveWeeksYear - totalHighWeeksYear - totalLowWeeksYear;

            if (totalActiveWeeksYear > 0) {
                const overallChartContainer = document.createElement('div');
                overallChartContainer.className = 'chart-container';
                overallChartContainer.style.height = "40vh";
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
                borderColor: ds.borderColor || ds.backgroundColor.replace('0.6', '1'),
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
                title: { display: true, text: title, font: {size: 16}},
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
