import { db, showViewLoader, setViewStatus } from '../script.js';

export function initManagePersonsView() {
    console.log("Initialisation de la vue Gestion Personnes");
    const refreshButton = document.getElementById('refreshPersonsListButton');
    if (refreshButton) refreshButton.addEventListener('click', loadPersonsList_ManageView);
    
    loadPersonsList_ManageView();
}

async function loadPersonsList_ManageView() {
    const tableBody = document.getElementById('personsTableBody');
    if (!db) { setViewStatus("Firebase non initialisé."); return; }
    if (!tableBody) { console.error("Élément DOM tableBody manquant pour ManagePersons."); return; }

    showViewLoader(true);
    tableBody.innerHTML = '';
    setViewStatus('Chargement de la liste des personnes...');

    try {
        const querySnapshot = await db.collection("heuresTravail").get();
        const distinctPersons = new Set();

        if (querySnapshot.empty) {
            setViewStatus('Aucune personne trouvée dans la base de données.');
        } else {
            querySnapshot.forEach(doc => {
                const data = doc.data();
                if (data.personne) {
                    distinctPersons.add(data.personne);
                }
            });

            if (distinctPersons.size === 0) {
                setViewStatus('Aucune personne avec des données enregistrées.');
            } else {
                const sortedPersons = Array.from(distinctPersons).sort();
                sortedPersons.forEach(personName => {
                    const row = tableBody.insertRow();
                    row.insertCell().textContent = personName;
                    
                    const actionsCell = row.insertCell();
                    const deleteButton = document.createElement('button');
                    deleteButton.textContent = 'Supprimer Données';
                    deleteButton.style.backgroundColor = '#dc3545';
                    deleteButton.addEventListener('click', () => confirmDeletePersonData_ManageView(personName));
                    actionsCell.appendChild(deleteButton);
                });
                setViewStatus(`Liste de ${distinctPersons.size} personne(s) chargée.`);
            }
        }
    } catch (error) {
        console.error("Erreur Firebase (ManagePersonsView - load):", error);
        setViewStatus(`Erreur: ${error.message}`);
    } finally {
        showViewLoader(false);
    }
}

function confirmDeletePersonData_ManageView(personNameToDelete) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer TOUTES les données pour "${personNameToDelete}" ? Cette action est irréversible.`)) {
        deletePersonData_ManageView(personNameToDelete);
    }
}

async function deletePersonData_ManageView(personNameToDelete) {
    if (!db) { setViewStatus("Firebase non initialisé."); return; }

    showViewLoader(true);
    setViewStatus(`Suppression des données pour ${personNameToDelete} en cours...`);

    try {
        const querySnapshot = await db.collection("heuresTravail")
                                    .where("personne", "==", personNameToDelete)
                                    .get();

        if (querySnapshot.empty) {
            setViewStatus(`Aucune donnée trouvée pour ${personNameToDelete} à supprimer.`);
            showViewLoader(false);
            loadPersonsList_ManageView();
            return;
        }

        const batch = db.batch();
        querySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        setViewStatus(`Toutes les données pour "${personNameToDelete}" ont été supprimées avec succès.`);
    
    } catch (error) {
        console.error("Erreur Firebase (ManagePersonsView - delete):", error);
        setViewStatus(`Erreur lors de la suppression: ${error.message}`);
    } finally {
        showViewLoader(false);
        loadPersonsList_ManageView();
    }
}