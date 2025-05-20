// views/dashboard.js
import { db, showViewLoader, setViewStatus } from '../script.js';

let allRawData = []; // Pour stocker toutes les données brutes de Firestore
let filteredAndSortedData = []; // Pour les données après filtrage et tri
let currentSortKey = null;
let currentSortDirection = 'asc'; // 'asc' ou 'desc'

const ITEMS_PER_PAGE = 15;
let currentPage = 1;

const MONTH_NAMES_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function initDashboardView() {
    console.log("Initialisation de la vue Dashboard");

    const refreshButton = document.getElementById('refreshButtonDashboard');
    const personFilterSelect = document.getElementById('personFilterDashboard');
    const yearFilterSelect = document.getElementById('yearFilterDashboard');
    const monthFilterSelect = document.getElementById('monthFilterDashboard');
    const searchInput = document.getElementById('searchFilterDashboard');
    const tableHeaders = document.querySelectorAll('#hoursTableDashboard th[data-sort-key]');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const exportPdfButton = document.getElementById('exportPdfButtonDashboard'); // NOUVEAU

    if (refreshButton) refreshButton.addEventListener('click', fetchDataFromFirestore);
    if (personFilterSelect) personFilterSelect.addEventListener('change', applyFiltersAndRender);
    if (yearFilterSelect) yearFilterSelect.addEventListener('change', applyFiltersAndRender);
    if (monthFilterSelect) monthFilterSelect.addEventListener('change', applyFiltersAndRender);
    if (searchInput) searchInput.addEventListener('input', debounce(applyFiltersAndRender, 300));
    if (exportPdfButton) exportPdfButton.addEventListener('click', exportDashboardToPdf_DashboardView); // NOUVEAU

    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const sortKey = th.getAttribute('data-sort-key');
            if (currentSortKey === sortKey) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortKey = sortKey;
                currentSortDirection = 'asc';
            }
            applyFiltersAndRender();
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
    
    // Vérifier si jspdf et autotable sont chargés pour le bouton PDF
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined' || typeof window.jspdf.jsPDF.API.autoTable === 'undefined') {
        console.warn("jsPDF ou jspdf-autotable non chargé. Export PDF du dashboard désactivé.");
        if(exportPdfButton) exportPdfButton.disabled = true;
    } else {
         if(exportPdfButton) exportPdfButton.disabled = false;
    }

    populateMonthFilter();
    fetchDataFromFirestore();
}

function populateMonthFilter() {
    const monthFilterSelect = document.getElementById('monthFilterDashboard');
    if(!monthFilterSelect) return;
    monthFilterSelect.innerHTML = '<option value="">Tous</option>'; 
    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        const monthValue = String(i + 1).padStart(2, '0'); 
        option.value = monthValue;
        option.textContent = MONTH_NAMES_FR[i];
        monthFilterSelect.appendChild(option);
    }
}

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
        
        populateStaticFilters();
        applyFiltersAndRender();
        setViewStatus(`Total de ${allRawData.length} entrée(s) chargées.`);
        if (allRawData.length === 0) {
            setViewStatus('Aucune donnée trouvée dans Firestore.');
        }

    } catch (error) {
        console.error("Erreur Firebase (DashboardView - fetchData):", error);
        setViewStatus(`Erreur: ${error.message}`, "error");
        allRawData = []; 
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
            if (year.match(/^\d{4}$/)) {
                 years.add(year);
            }
        }
    });

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
    Array.from(years).sort((a,b) => b-a).forEach(year => {
        const option = document.createElement('option');
        option.value = year; option.textContent = year;
        yearFilterSelect.appendChild(option);
    });
    yearFilterSelect.value = currentYear;
}


function applyFiltersAndRender() {
    const personFilter = document.getElementById('personFilterDashboard')?.value || "";
    const yearFilter = document.getElementById('yearFilterDashboard')?.value || "";
    const monthFilter = document.getElementById('monthFilterDashboard')?.value || "";
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
            const [itemYear, weekNumStr] = item.semaine.split('-W');
            const weekNum = parseInt(weekNumStr);
            if (!isNaN(weekNum) && itemYear.match(/^\d{4}$/)) {
                const firstDayOfYear = new Date(parseInt(itemYear), 0, 1);
                // Utiliser le 4ème jour de la semaine pour être plus robuste au passage de mois
                const dateInWeek = new Date(firstDayOfYear.valueOf() + (weekNum - 1) * 7 * 24 * 60 * 60 * 1000 + 3 * 24 * 60 * 60 * 1000);
                const itemMonth = String(dateInWeek.getMonth() + 1).padStart(2, '0');
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
                (item.dateEnregistrement?.toDate ? item.dateEnregistrement.toDate().toLocaleString('fr-FR') : "").toLowerCase().includes(searchTerm)
            );
        }
        return matchesPerson && matchesYear && matchesMonth && matchesSearch;
    });

    if (currentSortKey) {
        filteredAndSortedData.sort((a, b) => {
            let valA = a[currentSortKey];
            let valB = b[currentSortKey];

            if (currentSortKey === 'heures') {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            } else if (currentSortKey === 'dateEnregistrement') {
                valA = valA?.toDate ? valA.toDate().getTime() : 0;
                valB = valB?.toDate ? valB.toDate().getTime() : 0;
            } else if (typeof valA === 'string' && typeof valB === 'string') { // S'assurer que les deux sont des chaînes
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            } else if (valA === null || typeof valA === 'undefined') { // Gérer les nuls en les plaçant à la fin (ou au début)
                return currentSortDirection === 'asc' ? 1 : -1;
            } else if (valB === null || typeof valB === 'undefined') {
                return currentSortDirection === 'asc' ? -1 : 1;
            }


            if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    currentPage = 1; 
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
        console.error("Éléments DOM pour le tableau ou la pagination manquants (Dashboard).");
        return;
    }

    tableBody.innerHTML = ''; 

    if (filteredAndSortedData.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 4; 
        cell.textContent = 'Aucune donnée ne correspond à vos filtres.';
        cell.style.textAlign = 'center';
        paginationControlsDiv.style.display = 'none';
        return;
    }

    paginationControlsDiv.style.display = 'flex';
    const totalItems = filteredAndSortedData.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedItems = filteredAndSortedData.slice(startIndex, endIndex);

    paginatedItems.forEach(data => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = data.personne || 'N/A';
        row.insertCell().textContent = data.semaine || 'N/A';
        row.insertCell().textContent = data.heures != null ? data.heures.toFixed(2) : 'N/A'; 
        
        let dateEnregistrementText = 'N/A';
        if (data.dateEnregistrement && data.dateEnregistrement.toDate) {
            dateEnregistrementText = data.dateEnregistrement.toDate().toLocaleString('fr-FR', {dateStyle:'short', timeStyle:'short'});
        }
        row.insertCell().textContent = dateEnregistrementText;
    });

    pageInfoSpan.textContent = `Page ${totalPages > 0 ? currentPage : 0} sur ${totalPages}`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
    paginationControlsDiv.style.display = totalPages > 1 ? 'flex' : 'none';
}

// NOUVELLE FONCTION D'EXPORT PDF POUR LE DASHBOARD
async function exportDashboardToPdf_DashboardView() {
    const exportButton = document.getElementById('exportPdfButtonDashboard');
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        setViewStatus("La librairie jsPDF n'est pas chargée.", "error");
        if (exportButton) exportButton.disabled = true; // Désactiver si la lib manque
        return;
    }
    if (typeof window.jspdf.jsPDF.API.autoTable === 'undefined') {
        setViewStatus("La librairie jspdf-autotable n'est pas chargée (nécessaire pour l'export tableau).", "error");
        if (exportButton) exportButton.disabled = true;
        return;
    }

    if (filteredAndSortedData.length === 0) {
        setViewStatus("Aucune donnée à exporter en PDF.", "info");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' }); // 'l' pour landscape, mieux pour les tableaux larges

    showViewLoader(true);
    setViewStatus("Génération du PDF du tableau de bord...", "info");
    if (exportButton) exportButton.disabled = true;

    try {
        const tableTitle = "Tableau de Bord des Heures de Travail";
        const pageMargin = 15;
        const pageWidth = doc.internal.pageSize.getWidth();

        doc.setFontSize(18);
        doc.text(tableTitle, pageWidth / 2, pageMargin, { align: 'center' });
        
        // Informations sur les filtres actifs
        let filterInfo = "Filtres actifs : ";
        const personFilter = document.getElementById('personFilterDashboard')?.value;
        const yearFilter = document.getElementById('yearFilterDashboard')?.value;
        const monthFilter = document.getElementById('monthFilterDashboard')?.value;
        const searchTerm = document.getElementById('searchFilterDashboard')?.value;

        if (personFilter) filterInfo += `Personne: ${personFilter}; `;
        if (yearFilter) filterInfo += `Année: ${yearFilter}; `;
        if (monthFilter) {
            const monthName = MONTH_NAMES_FR[parseInt(monthFilter) -1];
            filterInfo += `Mois: ${monthName}; `;
        }
        if (searchTerm) filterInfo += `Recherche: "${searchTerm}"; `;
        if (filterInfo === "Filtres actifs : ") filterInfo += "Aucun";

        doc.setFontSize(9);
        doc.text(filterInfo, pageMargin, pageMargin + 10);

        // Extraire les données pour autoTable
        // Important: Exporter TOUTES les données filtrées, pas seulement la page actuelle
        const head = [['Personne', 'Semaine', 'Heures Travaillées', 'Date d\'Enregistrement']];
        const body = filteredAndSortedData.map(item => [
            item.personne || 'N/A',
            item.semaine || 'N/A',
            item.heures != null ? item.heures.toFixed(2) : 'N/A',
            item.dateEnregistrement?.toDate ? item.dateEnregistrement.toDate().toLocaleString('fr-FR', {dateStyle:'short', timeStyle:'short'}) : 'N/A'
        ]);

        doc.autoTable({
            head: head,
            body: body,
            startY: pageMargin + 15, // Après le titre et les filtres
            theme: 'striped', // ou 'grid', 'plain'
            headStyles: { fillColor: [41, 128, 185] }, // Un bleu pour l'en-tête
            styles: { fontSize: 8, cellPadding: 1.5 },
            columnStyles: {
                2: { halign: 'right' }, // Aligner les heures à droite
            },
            didDrawPage: function (data) {
                // Ajout d'un pied de page si nécessaire
                // doc.setFontSize(8);
                // doc.text('Page ' + doc.internal.getNumberOfPages(), data.settings.margin.left, doc.internal.pageSize.getHeight() - 10);
            }
        });

        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`dashboard_heures_${date}.pdf`);
        setViewStatus("PDF du tableau de bord généré avec succès.", "success");

    } catch (error) {
        console.error("Erreur lors de la génération du PDF du dashboard:", error);
        setViewStatus(`Erreur PDF: ${error.message}`, "error");
    } finally {
        showViewLoader(false);
        if (exportButton) exportButton.disabled = false;
    }
}
