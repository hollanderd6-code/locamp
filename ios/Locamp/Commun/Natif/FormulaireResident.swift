import SwiftUI

/// Creer ou modifier un resident (POST / PUT /api/residents).
struct FormulaireResident: View {
    /// nil : nouveau resident.
    let fiche: FicheResident?
    let termine: (_ residentId: String?) -> Void

    @Environment(\.dismiss) private var fermer
    @State private var civilite = ""
    @State private var prenom = ""
    @State private var nom = ""
    @State private var email = ""
    @State private var telephone = ""
    @State private var adresse = ""
    @State private var emplacementId = ""
    @State private var avecAssurance = false
    @State private var assuranceFin = Date.now
    @State private var assuranceRef = ""
    @State private var notes = ""
    @State private var actif = true
    @State private var emplacements: [Emplacement] = []
    @State private var envoi = false
    @State private var erreur: String?

    private var nouveau: Bool { fiche == nil }
    private var valide: Bool { !nom.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identité") {
                    Picker("Civilité", selection: $civilite) {
                        Text("—").tag(""); Text("M.").tag("M."); Text("Mme").tag("Mme")
                    }
                    TextField("Prénom", text: $prenom).textContentType(.givenName)
                    TextField("Nom", text: $nom).textContentType(.familyName)
                }
                Section("Contact") {
                    TextField("E-mail", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Téléphone", text: $telephone).textContentType(.telephoneNumber).keyboardType(.phonePad)
                    TextField("Adresse", text: $adresse, axis: .vertical).textContentType(.fullStreetAddress)
                }
                Section("Emplacement") {
                    Picker("Emplacement", selection: $emplacementId) {
                        Text("Aucun").tag("")
                        ForEach(emplacements) { e in
                            Text([e.numero?.valeur, e.secteur].compactMap { $0 }.joined(separator: " · ")).tag(e.id)
                        }
                    }
                }
                Section("Assurance") {
                    Toggle("Attestation reçue", isOn: $avecAssurance.animation())
                    if avecAssurance {
                        DatePicker("Valable jusqu'au", selection: $assuranceFin, displayedComponents: .date)
                            .environment(\.locale, Fmt.fr)
                        TextField("Référence du contrat", text: $assuranceRef)
                    }
                }
                Section("Notes internes") {
                    TextField("Visibles par l'équipe seulement", text: $notes, axis: .vertical).lineLimit(3...8)
                }
                if nouveau {
                    Section {
                    } footer: {
                        Text(email.isEmpty ? "Avec un e-mail, le résident reçoit une invitation à son espace locataire (factures, documents, messages)."
                                           : "Une invitation à l'espace locataire part à cette adresse dès la création.")
                    }
                } else {
                    Section {
                        Toggle("Résident actif", isOn: $actif)
                    } footer: {
                        Text("Un ancien résident n'est plus facturé ; son historique est conservé.")
                    }
                }
                if let erreur {
                    Section { Label(erreur, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                }
            }
            .navigationTitle(nouveau ? "Nouveau résident" : "Modifier")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler", systemImage: "xmark") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(nouveau ? "Créer" : "Enregistrer", systemImage: "checkmark") { Task { await enregistrer() } }
                        .buttonStyle(.glassProminent)
                        .disabled(!valide || envoi)
                }
            }
            .task { await preparer() }
        }
        .interactiveDismissDisabled(envoi)
    }

    private func preparer() async {
        if let r = fiche?.resident {
            civilite = r.civilite ?? ""; prenom = r.prenom ?? ""; nom = r.nom ?? ""
            email = r.email ?? ""; telephone = r.telephone ?? ""; adresse = r.adresse ?? ""
            emplacementId = fiche?.emplacement?.id ?? ""
            if let d = Fmt.date(r.assurance_expire_le) { avecAssurance = true; assuranceFin = d }
            assuranceRef = r.assurance_ref ?? ""; notes = r.notes_internes ?? ""; actif = r.actif != false
        }
        emplacements = (try? await ClientAPI.partage.requete("/api/emplacements", as: ReponseEmplacements.self).emplacements) ?? []
    }

    private func enregistrer() async {
        envoi = true; erreur = nil
        defer { envoi = false }
        func texte(_ s: String) -> Any { let t = s.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? NSNull() : t }
        var corps: [String: Any] = [
            "civilite": texte(civilite), "prenom": texte(prenom), "nom": nom.trimmingCharacters(in: .whitespaces),
            "email": texte(email.lowercased()), "telephone": texte(telephone), "adresse": texte(adresse),
            "emplacement_id": emplacementId.isEmpty ? NSNull() : emplacementId,
            "assurance_expire_le": avecAssurance ? assuranceFin.formatted(.iso8601.year().month().day()) : NSNull(),
            "assurance_ref": avecAssurance ? texte(assuranceRef) : NSNull(),
            "notes_internes": texte(notes),
        ]
        struct R: Decodable { struct Res: Decodable { let id: String }; let resident: Res }
        do {
            let r: R
            if let id = fiche?.resident.id {
                corps["actif"] = actif
                r = try await ClientAPI.partage.requete("/api/residents/\(id)", methode: "PUT", corps: corps, as: R.self)
            } else {
                corps["actif"] = true
                r = try await ClientAPI.partage.requete("/api/residents", methode: "POST", corps: corps, as: R.self)
            }
            Pont.partage.afficherToast(nouveau ? "Résident créé" : "Fiche enregistrée")
            termine(r.resident.id)
            fermer()
        } catch {
            erreur = error.localizedDescription
        }
    }
}
