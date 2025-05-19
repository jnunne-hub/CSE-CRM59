import { db, showViewLoader, setViewStatus } from '../script.js';

const THRESHOLD_HOURS_Charts = 35;
let currentChartInstance = null;

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

export function cleanupChartsView() { // Exportée pour être appelée par le routeur
    if (currentChartInstance) {
        currentChartInstance.destroy();
        currentChartInstance = null;
        console.log("Chart instance destroyed.");
    }
}

async function loadAndProcessData_ChartsView() {
    if (!db) { setViewStatus("Firebase non initialisé."); return; }
    if (typeof Chart === 'undefined') { setViewStatus("Chart.js non chargé."); return; }
    
    showViewLoader(true);
    setViewStatus('Chargement et traitement des données...');

    // Le cleanup est maintenant géré par le routeur via cleanupChartsView
    // if (currentChartInstance) {
    //     currentChartInstance.destroy();
    //     currentChartInstance = null;
    // }

    try {
        const querySnapshot = await db.collection("heuresTravail").get();
        if (querySnapshot.empty) {
            setViewStatus('Aucune donnée Firebase.'); showViewLoader(false); return;
        }

        const weeksOverThresholdByPerson = {};
        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (data.personne && typeof data.heures === 'number' && data.heures > THRESHOLD_HOURS_Charts) {
                weeksOverThresholdByPerson[data.personne] = (weeksOverThresholdByPerson[data.personne] || 0) + 1;
            }
        });

        if (Object.keys(weeksOverThresholdByPerson).length === 0) {
            setViewStatus(`Aucune semaine > ${THRESHOLD_HOURS_Charts}h trouvée.`);
            // S'il y avait un graphique précédent, il faut s'assurer qu'il est nettoyé même ici
            const chartCanvas = document.getElementById('weeksOver35hChart');
            if (chartCanvas) { // Effacer le canvas s'il n'y a pas de données à afficher
                const ctx = chartCanvas.getContext('2d');
                ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
            }
            showViewLoader(false); 
            return;
        }

        const labels = Object.keys(weeksOverThresholdByPerson).sort();
        const dataValues = labels.map(person => weeksOverThresholdByPerson[person]);
        renderChart_ChartsView(labels, dataValues);
        setViewStatus(`Graphique généré.`);
    } catch (error) {
        console.error("Erreur Firebase/Chart (ChartsView):", error);
        setViewStatus(`Erreur: ${error.message}`);
    } finally {
        showViewLoader(false);
    }
}

function renderChart_ChartsView(labels, dataValues) {
    const chartCanvas = document.getElementById('weeksOver35hChart');
    if (!chartCanvas) { console.error("Canvas pour graphique non trouvé"); return; }
    
    // Détruire l'instance précédente si elle existe (double sécurité avec le cleanup du routeur)
    if (currentChartInstance) {
        currentChartInstance.destroy();
    }

    const ctx = chartCanvas.getContext('2d');
    currentChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `Nombre de semaines > ${THRESHOLD_HOURS_Charts}h`,
                data: dataValues,
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Nombre de Semaines' }, ticks: { stepSize: 1, precision: 0 } },
                      x: { title: { display: true, text: 'Personne' } } },
            plugins: { legend: { position: 'top' },
                       tooltip: { callbacks: { label: context => `${context.dataset.label || ''}: ${context.parsed.y} semaine(s)` } } }
        }
    });
}