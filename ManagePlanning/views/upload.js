// views/upload.js

import { db, showViewLoader, setViewStatus } from '../script.js';

// --- Configuration commune pour UPLOAD VIEW ---
const WORK_ACTIVITY_PREFIXES = ['VAL_', 'REU_', 'FOR_', 'PRD_', 'ZZZ_'];
const EXPLICIT_NON_WORK_ACTIVITIES = ['PAU_REPAS'];
const NON_WORK_ACTIVITY_PREFIXES = ['ABS_', 'CGE_', 'MAL_'];
const FULL_DAY_WORK_HOURS_MAP = { 
    "FOR_FORMATION SYNDICALE": 7, 
    "PRD_TELETRAVAIL": 7
};
const MONTH_MAP_FR = {
    'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
    'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11
};

let currentWeeklyHoursData = {}; // Données calculées par le parseur pour la semaine actuelle
let personName = "Inconnu"; // Nom de la personne extrait du PDF

// Fonction principale d'initialisation pour cette vue, exportée pour script.js
export function initUploadView() {
    console.log("Initialisation de la vue Upload");
    
    const calculateButton = document.getElementById('calculateButton');
    const exportCsvButton = document.getElementById('exportCsvButton');
    const saveFirebaseButton = document.getElementById('saveFirebaseButton');
    const outputElement = document.getElementById('output'); // Ajout pour s'assurer qu'il est défini

    // Attacher les écouteurs d'événements
    if (calculateButton) calculateButton.addEventListener('click', processPDF_UploadView);
    if (exportCsvButton) exportCsvButton.addEventListener('click', exportToCSV_UploadView);
    if (saveFirebaseButton) saveFirebaseButton.addEventListener('click', saveDataToFirebase_UploadView);

    // Réinitialiser l'état de la vue
    currentWeeklyHoursData = {};
    personName = "Inconnu";
    if (outputElement) outputElement.textContent = ''; // Vider les résultats précédents
    if (exportCsvButton) exportCsvButton.style.display = 'none';
    if (saveFirebaseButton) saveFirebaseButton.style.display = 'none';
    
    // S'assurer que le loader de cette vue est masqué au cas où il serait resté d'une navigation précédente
    // setViewStatus est global et cible l'élément de statut de la vue courante
    setViewStatus(''); // Réinitialiser le message de statut (firebaseStatus dans ce cas)
    // showViewLoader est aussi global et cible le loader de la vue courante (#view-loader)
    showViewLoader(false); // Explicitement masquer le loader
}

async function processPDF_UploadView() {
    console.log("[UPLOAD] Début de processPDF_UploadView");
    const fileInput = document.getElementById('pdfFile');
    const outputElement = document.getElementById('output');
    const exportButton = document.getElementById('exportCsvButton');
    const saveFirebaseBtn = document.getElementById('saveFirebaseButton');

    // Vérifications robustes des éléments DOM
    if (!fileInput) { console.error("[UPLOAD] Element #pdfFile manquant."); return; }
    if (!outputElement) { console.error("[UPLOAD] Element #output manquant."); return; }
    if (!exportButton) { console.error("[UPLOAD] Element #exportCsvButton manquant."); return; }
    if (!saveFirebaseBtn) { console.error("[UPLOAD] Element #saveFirebaseButton manquant."); return; }
    
    outputElement.textContent = '';
    setViewStatus(''); 
    exportButton.style.display = 'none';
    saveFirebaseBtn.style.display = 'none';
    currentWeeklyHoursData = {};
    personName = "Inconnu";

    if (!fileInput.files || !fileInput.files.length) { // Vérification plus complète
        outputElement.textContent = 'Veuillez sélectionner un fichier PDF.';
        return;
    }
    if (typeof pdfjsLib === 'undefined') {
        outputElement.textContent = "Erreur: La librairie PDF.js n'a pas pu être chargée.";
        setViewStatus("Erreur librairie PDF", "error");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();
    showViewLoader(true);
    setViewStatus("Traitement du PDF en cours...", "info");

    reader.onload = async function(event) {
        try {
            if (!event.target || !event.target.result) {
                throw new Error("Erreur interne lors de la lecture du fichier PDF.");
            }
            const typedArray = new Uint8Array(event.target.result);
            const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
            let fullText = '';
            console.log(`[UPLOAD] PDF chargé, ${pdf.numPages} pages.`);

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str.trim()).filter(s => s.length > 0).join('\n');
                fullText += pageText + '\n\n'; // Ajouter deux sauts de ligne pour bien séparer le texte des pages
            }
            console.log("[UPLOAD] Texte extrait du PDF.");
            // console.log("Texte complet:", fullText.substring(0, 500) + "..."); // Log une partie pour vérification


            const linesOfText = fullText.split('\n');
            const planningLineRegex = /Planning de travail pour\s+(.+)/i;
            let nameLineFound = false;
            for (const line of linesOfText) {
                if (nameLineFound) break;
                const match = line.match(planningLineRegex);
                if (match && match[1]) {
                    let extractedName = match[1].trim();
                    const peoplewareIndex = extractedName.toLowerCase().indexOf("peopleware");
                    if (peoplewareIndex !== -1) extractedName = extractedName.substring(0, peoplewareIndex).trim();
                    const dayOfWeekInNameRegex = /\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}(\.|er)?\s+\w+/i; // Ajustement regex pour date avec/sans point
                    const dayMatchInName = extractedName.match(dayOfWeekInNameRegex);
                    if (dayMatchInName) extractedName = extractedName.substring(0, dayMatchInName.index).trim();
                    
                    if (extractedName && extractedName.length > 0) { // S'assurer que le nom n'est pas vide
                         personName = extractedName; 
                         nameLineFound = true;
                         console.log(`[UPLOAD] Nom extrait: ${personName}`);
                    }
                }
            }
            if (!nameLineFound) {
                console.warn("[UPLOAD] Nom de la personne non trouvé dans le PDF. Utilisation de 'Inconnu'.");
            }

            const weeklyHours = parseScheduleAndCalculateHours_UploadView(fullText); // La fonction clé
            // currentWeeklyHoursData est mis à jour dans displayResults_UploadView
            displayResults_UploadView(weeklyHours); 
            setViewStatus("Calcul des heures terminé.", "success");

        } catch (error) {
            console.error("[UPLOAD] Erreur lors du traitement du PDF:", error);
            if(outputElement) outputElement.textContent = `Erreur: ${error.message}. Vérifiez la console pour détails.`;
            setViewStatus("Erreur lors du traitement.", "error");
        } finally {
            showViewLoader(false);
        }
    };
    reader.onerror = function(e) {
        console.error("[UPLOAD] Erreur de lecture du fichier:", e);
        if(outputElement) outputElement.textContent = 'Erreur lors de la lecture du fichier.';
        setViewStatus("Erreur de lecture du fichier.", "error");
        showViewLoader(false);
    };
    reader.readAsArrayBuffer(file);
}

function parseDateString_UploadView(dateStrPart) {
    // console.log(`[UPLOAD PARSE DATE FN] Entrée: "${dateStrPart}"`);
    let cleaned = dateStrPart.replace('1er', '01'); // Gère "1er"
    cleaned = cleaned.replace(/\s+/g, ' '); // Normalise les espaces multiples en un seul
    cleaned = cleaned.replace(' .', '.'); // Ex: "01 ." -> "01."
    
    // Tenter de matcher "JOUR. MOIS ANNEE" ou "JOUR MOIS ANNEE"
    // Le point après le jour et le mois est optionnel
    const dateMatch = cleaned.match(/^(\d{1,2})\s*\.?\s*([a-zA-Zûûáéèàâêîôùüçë]+)\s*\.?\s*(\d{4})$/i);

    if (!dateMatch) {
        console.warn(`[UPLOAD PARSE DATE FN] Échec regex principal pour: "${dateStrPart}" (cleaned: "${cleaned}")`);
        return null;
    }

    const day = parseInt(dateMatch[1]);
    const monthNameRaw = dateMatch[2].toLowerCase(); // Prendre le nom du mois tel quel
    const year = parseInt(dateMatch[3]);

    // Normaliser les abréviations de mois si nécessaire
    let monthKey = monthNameRaw;
    if (monthKey === "févr" || monthKey === "fevrier") monthKey = "février"; // S'assurer que "février" est bien dans MONTH_MAP_FR
    if (monthKey === "avr" || monthKey === "avril.") monthKey = "avril";
    if (monthKey === "août." || monthKey === "aout") monthKey = "août";
    if (monthKey === "sept" || monthKey === "sept.") monthKey = "septembre";
    if (monthKey === "oct" || monthKey === "oct.") monthKey = "octobre";
    if (monthKey === "nov" || monthKey === "nov.") monthKey = "novembre";
    if (monthKey === "déc" || monthKey === "déc.") monthKey = "décembre";
    // Pour janvier, c'est probablement déjà bon.
    if (monthKey === "janv" || monthKey === "janv.") monthKey = "janvier";


    // console.log(`[UPLOAD PARSE DATE FN] Day:${day}, MonthKey:"${monthKey}", Year:${year}`);

    if (isNaN(day) || isNaN(year) || !(monthKey in MONTH_MAP_FR)) {
        console.warn(`[UPLOAD PARSE DATE FN] Validation finale échouée: Day:${day}, MonthKey:"${monthKey}" (in map? ${!!MONTH_MAP_FR[monthKey]}), Year:${year}`);
        return null;
    }
    return new Date(year, MONTH_MAP_FR[monthKey], day);
}

function getWeekNumber_UploadView(d) {
    if (!(d instanceof Date) || isNaN(d)) { console.error("[UPLOAD] getWeekNumber: Invalid date:", d); return "INVALID_WEEK"; }
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function calculateDuration_UploadView(startTimeStr, endTimeStr) {
    const [startH, startM] = startTimeStr.split(':').map(Number);
    const [endH, endM] = endTimeStr.split(':').map(Number);
    let diffMs = (new Date(0,0,0,endH,endM,0)) - (new Date(0,0,0,startH,startM,0));
    if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
    return diffMs / (1000 * 60 * 60);
}
        
function isWorkActivity_UploadView(activityDescription) {
    const norm = activityDescription.toUpperCase().trim();
    if (EXPLICIT_NON_WORK_ACTIVITIES.some(e => norm.includes(e))) return false;
    if (NON_WORK_ACTIVITY_PREFIXES.some(p => norm.startsWith(p))) return false;
    return WORK_ACTIVITY_PREFIXES.some(p => norm.startsWith(p));
}

function parseScheduleAndCalculateHours_UploadView(text) {
    console.log("[UPLOAD PARSE] >>> Début du Parsing des Heures et Semaines <<<");
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const weeklyHours = {}; // Stocke les heures de TRAVAIL par weekKey
    const allWeeksEncounteredLog = {}; // Pour un log plus détaillé: { "YYYY-WXX": ["date1", "date2"] }

    let currentDate = null; // La date du jour en cours de traitement
    let currentDayMarkedAsFullDayEvent = false; // Si le jour actuel est déjà couvert par un "Journée entière"
    let potentielJourSemaine = null; // Nom du jour lu, en attente de sa date

    const dayOfWeekRegex = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)$/i;
    const shortDateRegex = /^(\d{1,2}(?:er)?\s*\.?\s*[a-zA-ZÀ-ÿûûáéèàâêîôùüçë]+\.?\s+\d{4})$/i; 
    const timeSlotRegex = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+(.+)/;
    const fullDayRegex = /^Journée entière\s+(.+)/i;
    const ignorePatterns = [ /* ... vos patterns ... */ ];

    for (let i = 0; i < lines.length; i++) {
        let trimmedLine = lines[i];
        // console.log(`[RAW L${i}] "${trimmedLine}" | curD:${currentDate ? currentDate.toISOString().substring(0,10) : 'null'} | potJ:${potentielJourSemaine} | FDE:${currentDayMarkedAsFullDayEvent}`);

        if (trimmedLine === personName && personName !== "Inconnu") continue;
        if (ignorePatterns.some(p => p.test(trimmedLine))) continue;
        
        const dayMatchResult = trimmedLine.match(dayOfWeekRegex);
        if (dayMatchResult) {
            potentielJourSemaine = dayMatchResult[1];
            // Important : On réinitialise currentDate SEULEMENT quand on est sûr de changer de jour.
            // Pour l'instant, on a juste un "lundi", on attend sa date.
            // Si la ligne suivante n'est pas une date, potentielJourSemaine sera annulé.
            console.log(`[UPLOAD PARSE] Potentiel Jour: ${potentielJourSemaine}`);
            currentDate = null; // FORCER la réinitialisation de currentDate si un nom de jour est trouvé.
                                // Cela implique que la date DOIT suivre.
            currentDayMarkedAsFullDayEvent = false;
            continue;
        }

        // Si on a un "potentielJourSemaine" (ex: "lundi"), on s'attend à une date sur la ligne suivante (ou actuelle si le format du PDF combine).
        // Notre structure de PDF semble avoir le jour puis la date sur des lignes séparées.
        if (potentielJourSemaine) {
            const shortDateMatchResult = trimmedLine.match(shortDateRegex);
            if (shortDateMatchResult) {
                const newDate = parseDateString_UploadView(shortDateMatchResult[1]);
                if (newDate) {
                    console.log(`[UPLOAD PARSE] Date trouvée: ${newDate.toDateString()} (associée à ${potentielJourSemaine})`);
                    currentDate = newDate; // Date confirmée
                    currentDayMarkedAsFullDayEvent = false;
                    potentielJourSemaine = null; // Le jour a été consommé avec sa date

                    const weekKey = getWeekNumber_UploadView(currentDate);
                    if (!allWeeksEncounteredLog[weekKey]) allWeeksEncounteredLog[weekKey] = [];
                    if (!allWeeksEncounteredLog[weekKey].includes(currentDate.toDateString())) {
                        allWeeksEncounteredLog[weekKey].push(currentDate.toDateString());
                    }
                    
                    // Vérifier la ligne SUIVANTE pour "Journée entière" après avoir confirmé une date
                    if (i + 1 < lines.length) {
                        const nextLineFullDayMatch = lines[i + 1].match(fullDayRegex);
                        if (nextLineFullDayMatch) {
                            const fullDayActivityDesc = nextLineFullDayMatch[1].trim().toUpperCase();
                            const activityCode = fullDayActivityDesc.split(' ')[0];
                            console.log(`[UPLOAD PARSE] Journée entière (ligne suivante "${lines[i+1]}"): ${activityCode}`);
                            if (FULL_DAY_WORK_HOURS_MAP[activityCode]) { // S'applique SEULEMENT aux activités de travail
                                const duration = FULL_DAY_WORK_HOURS_MAP[activityCode];
                                if (duration > 0) {
                                    weeklyHours[weekKey] = (weeklyHours[weekKey] || 0) + duration;
                                    console.log(`[UPLOAD PARSE ADD] J.Ent (map): ${weekKey} +${duration}h pour ${activityCode}. Total sem: ${weeklyHours[weekKey]}`);
                                }
                            }
                            currentDayMarkedAsFullDayEvent = true;
                            i++; // Avancer l'index car on a traité la ligne de "Journée entière"
                            continue; // Passer à la ligne suivante dans la boucle principale
                        }
                    }
                    continue; // On a trouvé une date, on passe à la ligne suivante pour chercher des activités
                } else { // Le parsing de la date a échoué après un potentiel jour
                    console.warn(`[UPLOAD PARSE] Echec parsing date "${trimmedLine}" après potentiel jour "${potentielJourSemaine}". Réinitialisation.`);
                    potentielJourSemaine = null; 
                    // currentDate reste null ou sa valeur précédente
                }
            } else { // La ligne après le "jour de la semaine" n'est pas une date au format attendu
                // Cela pourrait être une "Journée entière" directement après le jour de la semaine
                const fullDayDirectMatch = trimmedLine.match(fullDayRegex);
                if (fullDayDirectMatch) {
                    // Ce cas est délicat car currentDate n'est pas encore défini par une ligne de date.
                    // Cela signifie que le format "JourDeSemaine" puis "Journée Entière ..." sans date intermédiaire.
                    // On DOIT avoir une date avant de pouvoir attribuer des heures.
                    // Si cela arrive souvent, il faut revoir la logique pour mémoriser l'activité et l'appliquer quand la date arrive.
                    console.warn(`[UPLOAD PARSE] "Journée entière" trouvée ("${trimmedLine}") APRÈS "${potentielJourSemaine}" MAIS AVANT une date. Sera ignorée pour l'instant.`);
                    // Ne pas réinitialiser potentielJourSemaine ici, la date pourrait encore arriver
                } else if (trimmedLine.length > 0) {
                    // Si ce n'est pas une date et pas "Journée entière", alors "potentielJourSemaine" était un faux positif.
                    // console.log(`[UPLOAD PARSE] Ligne "${trimmedLine}" non-date/non-J.Ent. après jour "${potentielJourSemaine}". Réinitialisation potJ.`);
                    potentielJourSemaine = null;
                }
            }
        }

        // Traitement des activités si une date est active pour le jour courant
        if (currentDate) {
            if (currentDayMarkedAsFullDayEvent) {
                // Si la journée est déjà couverte (ex: par un "Journée entière" sur la ligne précédente),
                // on ne traite plus de créneaux pour ce jour.
                continue; 
            }
            
            const weekKey = getWeekNumber_UploadView(currentDate);
            if (!allWeeksEncounteredLog[weekKey]) allWeeksEncounteredLog[weekKey] = [];
            if (!allWeeksEncounteredLog[weekKey].includes(currentDate.toDateString())) {
                 allWeeksEncounteredLog[weekKey].push(currentDate.toDateString());
            }

            const fullDayMatchOnActivity = trimmedLine.match(fullDayRegex);
            if (fullDayMatchOnActivity) {
                const fullDayActivityDesc = fullDayMatchOnActivity[1].trim().toUpperCase();
                const activityCode = fullDayActivityDesc.split(' ')[0];
                console.log(`[UPLOAD PARSE] Journée entière (ligne activité "${trimmedLine}"): ${activityCode}`);
                if (FULL_DAY_WORK_HOURS_MAP[activityCode]) {
                    const duration = FULL_DAY_WORK_HOURS_MAP[activityCode];
                    if (duration > 0) {
                        weeklyHours[weekKey] = (weeklyHours[weekKey] || 0) + duration;
                        console.log(`[UPLOAD PARSE ADD] J.Ent (map/act): ${weekKey} +${duration}h pour ${activityCode}. Total sem: ${weeklyHours[weekKey]}`);
                    }
                }
                currentDayMarkedAsFullDayEvent = true; // Ce jour est couvert
                continue;
            }

            const timeSlotMatchVal = trimmedLine.match(timeSlotRegex);
            if (timeSlotMatchVal) {
                const activityDescription = timeSlotMatchVal[3].trim();
                if (isWorkActivity_UploadView(activityDescription)) {
                    const duration = calculateDuration_UploadView(timeSlotMatchVal[1], timeSlotMatchVal[2]);
                    if (duration > 0) {
                        weeklyHours[weekKey] = (weeklyHours[weekKey] || 0) + duration;
                        console.log(`[UPLOAD PARSE ADD] Créneau: ${weekKey} +${duration}h pour ${activityDescription}. Total sem: ${weeklyHours[weekKey]}`);
                    }
                } else {
                    // console.log(`[UPLOAD PARSE] Activité non-travail ignorée: ${activityDescription}`);
                }
            }
        }
    }
    console.log("[UPLOAD PARSE] --- Fin de la boucle sur les lignes ---");
    
    const finalWeeklyDataToSave = {};
    // Transformer allWeeksEncounteredLog en un simple Set de weekKeys
    const allWeekKeysSet = new Set(Object.keys(allWeeksEncounteredLog));

    allWeekKeysSet.forEach(weekKey => {
        finalWeeklyDataToSave[weekKey] = weeklyHours[weekKey] || 0; 
    });
    
    console.log("[UPLOAD PARSE] Semaines uniques rencontrées dans le PDF (Dates par semaine):", allWeeksEncounteredLog);
    console.log("[UPLOAD PARSE] Données finales générées (heures par semaine):", JSON.parse(JSON.stringify(finalWeeklyDataToSave)));
    return finalWeeklyDataToSave;
}

function displayResults_UploadView(parsedData) { // Renommé parsedData pour clarté
    currentWeeklyHoursData = parsedData; // Mettre à jour les données globales avec les données parsées finales

    const outputElement = document.getElementById('output');
    const exportButton = document.getElementById('exportCsvButton');
    const saveFirebaseBtn = document.getElementById('saveFirebaseButton');
    if (!outputElement || !exportButton || !saveFirebaseBtn) {
        console.error("[UPLOAD] Éléments DOM pour displayResults manquants.");
        return;
    }

    let resultText = `Heures de travail pour ${personName} par semaine :\n(inclut les semaines avec 0h de travail si présentes dans le planning)\n\n`;
    const sortedWeeks = Object.keys(currentWeeklyHoursData).sort();

    if (sortedWeeks.length === 0) {
        resultText += "Aucune semaine traitée ou aucune heure de travail calculée.\n";
        exportButton.style.display = 'none'; 
        saveFirebaseBtn.style.display = 'none';
    } else {
        sortedWeeks.forEach(week => {
            const hours = currentWeeklyHoursData[week];
            resultText += `Semaine ${week}: ${typeof hours === 'number' ? hours.toFixed(2) : 'N/A'} heures\n`;
        });
        exportButton.style.display = 'inline-block';
        if (db) saveFirebaseBtn.style.display = 'inline-block';
    }
    outputElement.textContent = resultText;
}

function exportToCSV_UploadView() {
    if (Object.keys(currentWeeklyHoursData).length === 0) { alert("Aucune donnée à exporter."); return; }
    let csv = "Personne,Semaine,HeuresTravaillees\r\n";
    Object.keys(currentWeeklyHoursData).sort().forEach(week => {
        csv += `"${personName.replace(/"/g, '""')}","${week}","${currentWeeklyHoursData[week].toFixed(2)}"\r\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `heures_${personName.replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'planning'}_${new Date().toISOString().slice(0, 10).replace(/-/g,'')}.csv`;
    document.body.appendChild(link); 
    link.click();
    document.body.removeChild(link); 
    URL.revokeObjectURL(link.href);
}

async function saveDataToFirebase_UploadView() {
    const firebaseStatusEl = document.getElementById('firebaseStatus'); // Devrait être activeStatusMessage via setViewStatus
    if (!db) { setViewStatus("Erreur: Firebase non initialisé.", "error"); return; }
    if (Object.keys(currentWeeklyHoursData).length === 0) { setViewStatus("Aucune donnée à enregistrer.", "info"); return; }

    showViewLoader(true);
    setViewStatus("Enregistrement sur Firebase...", "info");
    const saveBtn = document.getElementById('saveFirebaseButton');
    if (saveBtn) saveBtn.disabled = true;
    
    const batch = db.batch();
    let saveCount = 0;
    for (const weekKey in currentWeeklyHoursData) {
        // Créer un ID de document unique pour chaque personne/semaine pour éviter les doublons stricts lors de la réimportation.
        // S'assurer que personName est valide pour un ID de document (pas de / etc.)
        const safePersonName = personName.replace(/[\s./#[\]$]/g, '_'); // Remplacer les caractères invalides pour Firestore ID
        const docId = `${safePersonName}_${weekKey}`; // ID personnalisé

        const docRef = db.collection("heuresTravail").doc(docId); 
        const dataToSave = {
            personne: personName, 
            semaine: weekKey,
            heures: parseFloat(currentWeeklyHoursData[weekKey].toFixed(2)), // S'assurer que c'est un nombre
            dateEnregistrement: firebase.firestore.FieldValue.serverTimestamp()
        };
        batch.set(docRef, dataToSave, { merge: true }); // Utiliser set avec merge:true pour écraser/mettre à jour si docId existe déjà
        saveCount++;
    }

    try {
        await batch.commit();
        setViewStatus(`${saveCount} semaine(s) pour ${personName} enregistrée(s) / mise(s) à jour !`, "success");
        console.log(`[UPLOAD] Données enregistrées/mises à jour sur Firebase pour ${personName}.`);
    } catch (e) {
        console.error("[UPLOAD] Erreur Firebase (saveDataToFirebase_UploadView):", e); 
        setViewStatus(`Erreur lors de l'enregistrement: ${e.message}`, "error");
    } finally {
        showViewLoader(false); 
        if (saveBtn) saveBtn.disabled = false;
    }
}
