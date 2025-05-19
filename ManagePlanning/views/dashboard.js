// views/dashboard.js
import { db, showViewLoader, setViewStatus } from '../script.js';

let allRawData = []; // Pour stocker toutes les données brutes de Firestore
let filteredAndSortedData = []; // Pour les données après filtrage et tri
let currentSortKey = null;
let currentSortDirection = 'asc'; // 'asc' ou 'desc'

// Pour la pagination (optionnel mais recommandé pour de grands ensembles de données)
const ITEMS_PER_PAGE = 15;
let currentPage = 1;

const MONTH_NAMES_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function initDashboardView() {
    console.log("Initialisation de la vue Dashboard");

    // Sélecteurs DOM
    const refreshButton = document.getElementById('refreshButtonDashboard');
    const personFilterSelect = document.getElementById('personFilterDashboard');
    const yearFilterSelect = document.getElementById('yearFilterDashboard');
    const monthFilterSelect = document.getElementById('monthFilterDashboard');
    const searchInput = document.getElementById('searchFilterDashboard');
    const tableHeaders = document.querySelectorAll('#hoursTableDashboard th[data-sort-key]');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');


    // Écouteurs d'événements
    if (refreshButton) refreshButton.addEventListener('click', fetchDataFromFirestore);
    if (personFilterSelect) personFilterSelect.addEventListener('change', applyFiltersAndRender);
    if (yearFilterSelect) yearFilterSelect.addEventListener('change', applyFiltersAndRender);
    if (monthFilterSelect) monthFilterSelect.addEventListener('change', applyFiltersAndRender);
    if (searchInput) searchInput.addEventListener('input', debounce(applyFiltersAndRender, 300)); // Debounce pour la performance

    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const sortKey = th.getAttribute('data-sort-key');
            if (currentSortKey === sortKey) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortKey = sortKey;
                currentSortDirection = 'asc';
            }
            applyFiltersAndRender(); // Retrier et réafficher
            updateSortArrows(tableHeaders);
        });
    });

    if (prevPageBtn) prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });
    if (nextPageBtn) nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredAndSortedData.length / ITEMS_PER_PAGE);
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
    });
    

    populateMonthFilter();
    fetchDataFromFirestore(); // Charger les données initiales
}

function populateMonthFilter() {
    const monthFilterSelect = document.getElementById('monthFilterDashboard');
    if(!monthFilterSelect) return;
    monthFilterSelect.innerHTML = '<option value="">Tous</option>'; // Garder l'option "Tous"
    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        const monthValue = String(i + 1).padStart(2, '0'); // 01, 02, ... 12
        option.value = monthValue;
        option.textContent = MONTH_NAMES_FR[i];
        monthFilterSelect.appendChild(option);
    }
}

// Debounce function pour éviter trop d'appels sur 'input'
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

async function fetchDataFromFirestore() {
    if (!db) { setViewStatus("Firebase non initialisé.", "error"); return; }

    showViewLoader(true);
    setViewStatus('Chargement des données depuis Firestore...');
    
    try {
        const querySnapshot = await db.collection("heuresTravail").orderBy("dateEnregistrement", "desc").get();
        allRawData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        populateStaticFilters(); // Peupler les filtres personne et année
        applyFiltersAndRender(); // Appliquer les filtres par défaut et afficher
        setViewStatus(`Total de ${allRawData.length} entrée(s) chargées.`, "success");
        if (allRawData.length === 0) {
            setViewStatus('Aucune donnée trouvée dans Firestore.');
        }

    } catch (error) {
        console.error("Erreur Firebase (DashboardView - fetchData):", error);
        setViewStatus(`Erreur: ${error.message}`, "error");
        allRawData = []; // Assurer que c'est vide en cas d'erreur
        applyFiltersAndRender();
    } finally {
        showViewLoader(false);
    }
}

function populateStaticFilters() {
    const personFilterSelect = document.getElementById('personFilterDashboard');
    const yearFilterSelect = document.getElementById('yearFilterDashboard');

    if (!personFilterSelect || !yearFilterSelect) return;

    const persons = new Set();
    const years = new Set();

    allRawData.forEach(item => {
        if (item.personne) persons.add(item.personne);
        if (item.semaine) {
            const year = item.semaine.substring(0, 4);
            if (year.match(/^\d{4}$/)) { // S'assurer que c'est bien une année
                 years.add(year);
            }
        }
    });

    // Garder les valeurs actuelles des filtres si elles existent
    const currentPerson = personFilterSelect.value;
    const currentYear = yearFilterSelect.value;

    personFilterSelect.innerHTML = '<option value="">Toutes</option>';
    Array.from(persons).sort().forEach(person => {
        const option = document.createElement('option');
        option.value = person; option.textContent = person;
        personFilterSelect.appendChild(option);
    });
    personFilterSelect.value = currentPerson;


    yearFilterSelect.innerHTML = '<option value="">Toutes</option>';
    Array.from(years).sort((a,b) => b-a).forEach(year => { // Trier les années, plus récentes en premier
        const option = document.createElement('option');
        option.value = year; option.textContent = year;
        yearFilterSelect.appendChild(option);
    });
    yearFilterSelect.value = currentYear;
}


function applyFiltersAndRender() {
    const personFilter = document.getElementById('personFilterDashboard')?.value || "";
    const yearFilter = document.getElementById('yearFilterDashboard')?.value || "";
    const monthFilter = document.getElementById('monthFilterDashboard')?.value || ""; // ex: "01", "02", ..., "12"
    const searchTerm = document.getElementById('searchFilterDashboard')?.value.toLowerCase() || "";

    filteredAndSortedData = allRawData.filter(item => {
        let matchesPerson = true;
        let matchesYear = true;
        let matchesMonth = true;
        let matchesSearch = true;

        if (personFilter) {
            matchesPerson = item.personne === personFilter;
        }
        if (yearFilter && item.semaine) {
            matchesYear = item.semaine.startsWith(yearFilter + "-W");
        }
        if (monthFilter && item.semaine && item.semaine.includes("-W")) {
            // Extrait l'année et le numéro de semaine
            const [itemYear, weekNumStr] = item.semaine.split('-W');
            const weekNum = parseInt(weekNumStr);
            if (!isNaN(weekNum)) {
                // Calculer le mois approximatif de la semaine
                const firstDayOfYear = new Date(parseInt(itemYear), 0, 1);
                const firstDayOfWeek = new Date(firstDayOfYear.valueOf() + (weekNum - 1) * 7 * 24 * 60 * 60 * 1000);
                // Il est plus simple de comparer avec une date du milieu de la semaine pour la plupart des cas
                const middleDayOfWeek = new Date(firstDayOfWeek.valueOf() + 3 * 24 * 60 * 60 * 1000); 
                const itemMonth = String(middleDayOfWeek.getMonth() + 1).padStart(2, '0');
                matchesMonth = itemMonth === monthFilter;
            } else {
                matchesMonth = false;
            }
        }


        if (searchTerm) {
            matchesSearch = (
                item.personne?.toLowerCase().includes(searchTerm) ||
                item.semaine?.toLowerCase().includes(searchTerm) ||
                (item.heures?.toString() || "").includes(searchTerm) ||
                (item.dateEnregistrement?.toDate().toLocaleString('fr-FR') || "").toLowerCase().includes(searchTerm)
            );
        }
        return matchesPerson && matchesYear && matchesMonth && matchesSearch;
    });

    // Tri
    if (currentSortKey) {
        filteredAndSortedData.sort((a, b) => {
            let valA = a[currentSortKey];
            let valB = b[currentSortKey];

            // Traitement spécifique pour certains types de données
            if (currentSortKey === 'heures') {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            } else if (currentSortKey === 'dateEnregistrement') {
                valA = valA?.toDate ? valA.toDate().getTime() : 0;
                valB = valB?.toDate ? valB.toDate().getTime() : 0;
            } else if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    currentPage = 1; // Revenir à la première page après un filtre ou un tri
    renderTable();
}

function updateSortArrows(tableHeaders) {
    tableHeaders.forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.getAttribute('data-sort-key') === currentSortKey) {
            th.classList.add(currentSortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });
}

function renderTable() {
    const tableBody = document.getElementById('tableBodyDashboard');
    const paginationControlsDiv = document.getElementById('dashboardPaginationControls');
    const pageInfoSpan = document.getElementById('pageInfo');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    if (!tableBody || !paginationControlsDiv || !pageInfoSpan || !prevPageBtn || !nextPageBtn) {
        console.error("Éléments DOM pour le tableau ou la pagination manquants.");
        return;
    }

    tableBody.innerHTML = ''; // Vider le tableau

    if (filteredAndSortedData.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 4; // Nombre de colonnes
        cell.textContent = 'Aucune donnée ne correspond à vos filtres.';
        cell.style.textAlign = 'center';
        paginationControlsDiv.style.display = 'none';
        return;
    }

    paginationControlsDiv.style.display = 'flex';
    const totalItems = filteredAndSortedData.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    
    // S'assurer que currentPage est valide
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;


    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedItems = filteredAndSortedData.slice(startIndex, endIndex);

    paginatedItems.forEach(data => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = data.personne || 'N/A';
        row.insertCell().textContent = data.semaine || 'N/A';
        row.insertCell().textContent = data.heures != null ? data.heures.toFixed(2) : 'N/A'; // Vérifier null/undefined
        
        let dateEnregistrementText = 'N/A';
        if (data.dateEnregistrement && data.dateEnregistrement.toDate) {
            dateEnregistrementText = data.dateEnregistrement.toDate().toLocaleString('fr-FR', {dateStyle:'short', timeStyle:'short'});
        }
        row.insertCell().textContent = dateEnregistrementText;
    });

    // Mettre à jour les infos de pagination
    pageInfoSpan.textContent = `Page ${totalPages > 0 ? currentPage : 0} sur ${totalPages}`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;

    // Afficher/masquer les contrôles si une seule page
     paginationControlsDiv.style.display = totalPages > 1 ? 'flex' : 'none';
}
