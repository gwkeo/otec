const { createApp } = Vue

const sb = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
)

createApp({

    data() {
        return {
            user: null,

            email: "",
            password: "",

            participants: [],
            operations: [],
            snapshots: [],
            rows: [],

            newOperation: {
                from: null,
                to: null,
                amount: 0
            }
        }
    },

    computed: {

        totalBalance() {
            const latest = {}
            this.snapshots.forEach(s => {
                if (!latest[s.participant_id] ||
                    s.created_at > latest[s.participant_id].created_at) {
                    latest[s.participant_id] = s
                }
            })
            return Object.values(latest)
                .reduce((sum, s) => sum + Number(s.amount || 0), 0)
        },

        todayTotal() {
            const today = new Date()
                .toISOString()
                .slice(0, 10)

            return this.operations
                .filter(op => op.created_at.slice(0, 10) === today)
                .reduce((sum, op) => sum + Number(op.amount || 0), 0)
        }
    },

    methods: {

        async login() {

            const { data, error } =
                await sb.auth.signInWithPassword({
                    email: this.email,
                    password: this.password
                })

            if (error) {
                alert(error.message)
                return
            }

            this.user = data.user
            await this.loadData()
        },

        async logout() {
            await sb.auth.signOut()
            location.reload()
        },

        async loadData() {

            const participantsRes =
                await sb
                    .from("Participants")
                    .select("*")
                    .order("id")

            this.participants = participantsRes.data || []

            const operationsRes =
                await sb
                    .from("Operations")
                    .select("*")
                    .order("created_at")

            this.operations = operationsRes.data || []

            const snapshotsRes =
                await sb
                    .from("Snapshot")
                    .select("*")

            this.snapshots = snapshotsRes.data || []

            this.buildRows()
        },

        buildRows() {

            const map = {}

            this.operations.forEach(op => {

                const date = op.created_at.slice(0, 10)

                if (!map[date]) {
                    map[date] = { date, values: {} }
                }

                const id = op.from
                map[date].values[id] =
                    (map[date].values[id] || 0) + Number(op.amount || 0)
            })

            this.rows = Object.values(map)
                .sort((a, b) => b.date.localeCompare(a.date))
        },

        rowTotal(row) {
            return Object.values(row.values)
                .reduce((sum, v) => sum + Number(v || 0), 0)
        },

        async updateSnapshot(participantId, delta) {

            const latest = this.snapshots
                .filter(s => s.participant_id === participantId)
                .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]

            const currentAmount = latest ? Number(latest.amount) : 0

            await sb
                .from("Snapshot")
                .insert({
                    participant_id: participantId,
                    amount: currentAmount + delta,
                    created_at: new Date().toISOString()
                })
        },

        async createOperation() {

            const { from, to, amount } = this.newOperation

            await sb
                .from("Operations")
                .insert({
                    from,
                    to,
                    amount,
                    created_at: new Date().toISOString()
                })

            await this.updateSnapshot(from, -amount)
            await this.updateSnapshot(to, +amount)

            this.newOperation.amount = 0

            await this.loadData()
        }
    },

    async mounted() {

        const result = await sb.auth.getUser()

        this.user = result.data.user

        if (this.user)
            await this.loadData()
    }

}).mount("#app")
