import { db, showViewLoader, setViewStatus } from '../script.js';

let allPersons_Dashboard = new Set();

export function initDashboardView() {
    console.log("Initialisation de la vue Dashboard");
    const refreshButton = document.getElementById('refreshButtonDashboard');
    const personFilterSelect = document.getElementById('personFilter');

    if (refreshButton) refreshButton.addEventListener('click', loadData_DashboardView);
    if (personFilterSelect) personFilterSelect.addEventListener('change', loadData_DashboardView);
    
    allPersons_Dashboard.clear();
    loadData_DashboardView();
}

function populatePersonFilter_DashboardView() {
    const personFilterSelect = document.getElementById('personFilter');
    if (!personFilterSelect) return;
    const currentFilterValue = personFilterSelect.value;
    personFilterSelect.innerHTML = '<option value="">Toutes les personnes</option>';
    Array.from(allPersons_Dashboard).sort().forEach(person => {
        const option = document.createElement('option');
        option.value = person; option.textContent = person;
        personFilterSelect.appendChild(option);
    });
    personFilterSelect.value = currentFilterValue;
}

async function loadData_DashboardView() {
    const tableBody = document.getElementById('tableBody');
    const personFilterSelect = document.getElementById('personFilter');

    if (!db) { setViewStatus("Firebase non initialisé."); return; }
    if (!tableBody || !personFilterSelect) { console.error("Éléments DOM manquants pour Dashboard."); return; }

    showViewLoader(true);
    tableBody.innerHTML = '';
    setViewStatus('Chargement des données...');
    
    const selectedPerson = personFilterSelect.value;
    if (!selectedPerson) { // Seulement si on charge tout, on vide et repeuple la liste des personnes
        allPersons_Dashboard.clear();
    }

    try {
        let query = db.collection("heuresTravail").orderBy("dateEnregistrement", "desc");
        if (selectedPerson) {
            query = query.where("personne", "==", selectedPerson);
        }
        const querySnapshot = await query.get();

        if (querySnapshot.empty) {
            setViewStatus('Aucune donnée trouvée.');
        } else {
            querySnapshot.forEach(doc => {
                const data = doc.data();
                if (!selectedPerson) allPersons_Dashboard.add(data.personne);

                const row = tableBody.insertRow();
                row.insertCell().textContent = data.personne || 'N/A';
                row.insertCell().textContent = data.semaine || 'N/A';
                row.insertCell().textContent = data.heures ? data.heures.toFixed(2) : 'N/A';
                let dateText = 'N/A';
                if (data.dateEnregistrement && data.dateEnregistrement.toDate) {
                    dateText = data.dateEnregistrement.toDate().toLocaleString('fr-FR');
                }
                row.insertCell().textContent = dateText;
            });
            setViewStatus(`Affichage de ${querySnapshot.size} entrée(s).`);
            if (!selectedPerson) populatePersonFilter_DashboardView();
        }
    } catch (error) {
        console.error("Erreur Firebase (DashboardView):", error);
        setViewStatus(`Erreur: ${error.message}`);
    } finally {
        showViewLoader(false);
    }
}