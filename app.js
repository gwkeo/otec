import { createApp } from 'vue'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
);

createApp({
    data() {
        return {
            user: null,
            email: '',
            password: '',
            participants: [],
            operations: [],
            snapshots: [],
            originalAmounts: {},
            selectedParticipant: null,
            newOperation: {
                shop_id: null,
                from: null,
                to: null,
                amount: 0,
                op_date: new Date().toISOString().slice(0, 10),
                kind: 'transfer',
                currency: 'RUB',
                note: ''
            },
            manualDate: false,
            selectedDate: new Date().toISOString().slice(0, 10),
            currentPage: 1,
            rowsPerPage: 10,
            workerParticipantTypeId: null,
            isLoadingWorkerType: false,
            workerTypeError: null,
            newWorker: {
                name: ''
            },
            userRole: null,
            currentPersonId: null,
            myShops: [],
            roleLoading: true,
            roleError: null,
            selectedShop: null,
            adminBalances: [],
            workerSalaries: [],
            shopMembers: [],
            participantTypes: [],
            newParticipant: {
                name: '',
                type: ''
            },
            adminTab: 'dashboard'
        };
    },

    computed: {
        isAdmin() {
            return this.userRole === 'admin';
        },

        isWorker() {
            return this.userRole === 'worker';
        },

        allOperations() {
            if (!this.selectedParticipant) return [];

            return this.operations
                .filter(op => op.from === this.selectedParticipant || op.to === this.selectedParticipant)
                .map(op => ({
                    ...op,
                    isIncome: op.to === this.selectedParticipant,
                    counterparty: op.to === this.selectedParticipant ? op.from : op.to
                }))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        },
        
        totalPages() {
            return Math.ceil(this.allOperations.length / this.rowsPerPage);
        },
        
        paginatedOperations() {
            const start = (this.currentPage - 1) * this.rowsPerPage;
            const end = start + this.rowsPerPage;
            return this.allOperations.slice(start, end);
        },
        
        pageNumbers() {
            const delta = 2;
            const range = [];
            const rangeWithDots = [];
            let l;
            
            for (let i = 1; i <= this.totalPages; i++) {
                if (i === 1 || i === this.totalPages || 
                    (i >= this.currentPage - delta && i <= this.currentPage + delta)) {
                    range.push(i);
                }
            }
            
            range.forEach(i => {
                if (l) {
                    if (i - l === 2) {
                        rangeWithDots.push(l + 1);
                    } else if (i - l !== 1) {
                        rangeWithDots.push('...');
                    }
                }
                rangeWithDots.push(i);
                l = i;
            });
            
            return rangeWithDots;
        },

        currentBalance() {
            if (!this.selectedParticipant) return 0;
            
            const participantSnapshots = this.snapshots
                .filter(s => s.participant_id === this.selectedParticipant)
                .sort((a, b) => b.created_at.localeCompare(a.created_at));
            
            if (participantSnapshots.length === 0) return 0;
            
            return Number(participantSnapshots[0].last_amount || 0);
        }
    },

    methods: {
        async login() {
            try {
                const { data, error } = await sb.auth.signInWithPassword({
                    email: this.email,
                    password: this.password
                });
                if (error) throw error;
                this.user = data.user;
                await this.loadUserRole();
                await this.loadData();
                this.email = '';
                this.password = '';
            } catch (error) {
                alert(error.message);
            }
        },

        async logout() {
            await sb.auth.signOut();
            this.user = null;
            this.userRole = null;
            this.currentPersonId = null;
            this.myShops = [];
            this.participants = [];
            this.operations = [];
            this.snapshots = [];
            this.selectedParticipant = null;
            this.selectedShop = null;
            this.newOperation = { to: null, amount: 0 };
            this.currentPage = 1;
        },

        async loadUserRole() {
            try {
                this.roleLoading = true;
                this.roleError = null;

                const { data: isAdmin, error: adminError } = await sb.rpc('is_admin');
                if (adminError) throw adminError;

                const { data: personId, error: personError } = await sb.rpc('current_person_id');
                if (personError) throw personError;

                const { data: shopIds, error: shopsError } = await sb.rpc('user_shop_ids');
                if (shopsError) throw shopsError;

                this.userRole = isAdmin ? 'admin' : 'worker';
                this.currentPersonId = personId;
                this.myShops = shopIds || [];

                if (this.myShops.length > 0) {
                    this.selectedShop = this.myShops[0];
                }

                if (isAdmin) {
                    await this.loadAdminDashboard();
                    await this.loadWorkerSalaries();
                    await this.loadShopMembers();
                    await this.loadParticipantTypes();
                }
            } catch (error) {
                console.error('Error loading user role:', error);
                this.roleError = error.message;
                this.userRole = null;
            } finally {
                this.roleLoading = false;
            }
        },

        async loadParticipantTypes() {
            try {
                const { data, error } = await sb
                    .from('participant_types')
                    .select('*');

                if (error) throw error;
                this.participantTypes = data || [];
            } catch (error) {
                console.error('Error loading participant types:', error);
            }
        },

        async loadData() {
            try {
                const { data: participants, error: pError } = await sb
                    .from('Participants')
                    .select('*')
                    .order('id');
                if (pError) throw pError;
                this.participants = participants || [];

                let operationsQuery = sb
                    .from('Operations')
                    .select('*');

                if (this.isWorker && this.selectedShop) {
                    operationsQuery = operationsQuery.eq('shop_id', this.selectedShop);
                }

                const { data: operations, error: opError } = await operationsQuery
                    .order('op_date', { ascending: false });
                if (opError) throw opError;
                this.operations = operations || [];

                const { data: snapshots, error: snapError } = await sb
                    .from('Snapshot')
                    .select('*');
                if (snapError) throw snapError;
                this.snapshots = snapshots || [];

                this.originalAmounts = {};
                (operations || []).forEach(op => {
                    this.originalAmounts[op.id] = op.amount;
                });

                if (!this.selectedParticipant && this.participants.length) {
                    this.selectedParticipant = this.participants[0].id;
                }

                await this.loadWorkerParticipantType();

                this.currentPage = 1;
            } catch (error) {
                console.error('Error loading data:', error);
                alert(`Ошибка при загрузке данных: ${error.message}`);
            }
        },

        async loadWorkerParticipantType() {
            try {
                this.isLoadingWorkerType = true;
                this.workerTypeError = null;

                const { data, error } = await sb
                    .from('participant_types')
                    .select('id')
                    .eq('code', 'worker')
                    .single();

                if (error) {
                    if (error.code === 'PGRST116') {
                        this.workerTypeError = 'Не найден тип participant_type "worker"';
                    } else {
                        this.workerTypeError = `Ошибка при загрузке типа worker: ${error.message}`;
                    }
                    this.workerParticipantTypeId = null;
                } else if (data) {
                    this.workerParticipantTypeId = data.id;
                    this.workerTypeError = null;
                }
            } catch (err) {
                console.error('Error loading worker participant type:', err);
                this.workerTypeError = 'Ошибка при загрузке типа worker';
                this.workerParticipantTypeId = null;
            } finally {
                this.isLoadingWorkerType = false;
            }
        },

        getParticipantName(id) {
            const participant = this.participants.find(p => p.id === id);
            return participant ? participant.name : 'Неизвестно';
        },

        formatDate(dateString) {
            const date = new Date(dateString);
            return date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        },

        nextPage() {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
            }
        },

        prevPage() {
            if (this.currentPage > 1) {
                this.currentPage--;
            }
        },

        goToPage(page) {
            if (page !== '...' && page >= 1 && page <= this.totalPages) {
                this.currentPage = page;
            }
        },

        async updateSnapshot(participantId, delta) {
            const participantSnapshots = this.snapshots
                .filter(s => s.participant_id === participantId)
                .sort((a, b) => b.created_at.localeCompare(a.created_at));
            
            const latestSnapshot = participantSnapshots[0];
            const currentAmount = latestSnapshot ? Number(latestSnapshot.last_amount) : 0;

            const { error } = await sb
                .from('Snapshot')
                .insert({
                    participant_id: participantId,
                    last_amount: currentAmount + delta,
                    created_at: new Date().toISOString()
                });
            
            if (error) {
                console.error('Error updating snapshot:', error);
                throw error;
            }
        },

        async createOperation() {
            const { shop_id, from, to, amount, op_date, kind, currency, note } = this.newOperation;

            if (!shop_id) {
                alert('Выберите точку');
                return;
            }

            if (!from || !to || amount <= 0) {
                alert('Заполните все поля');
                return;
            }

            try {
                const { error } = await sb
                    .from('Operations')
                    .insert({
                        shop_id,
                        from,
                        to,
                        amount: Math.floor(amount),
                        op_date,
                        kind,
                        currency,
                        note: note || null
                    });

                if (error) {
                    alert(`Ошибка при создании операции: ${error.message}`);
                    console.error(error);
                    return;
                }

                this.newOperation = {
                    shop_id: this.selectedShop || null,
                    from: this.currentPersonId || null,
                    to: null,
                    amount: 0,
                    op_date: new Date().toISOString().slice(0, 10),
                    kind: 'transfer',
                    currency: 'RUB',
                    note: ''
                };

                await this.loadData();
                alert('Операция успешно создана');
            } catch (error) {
                console.error('Error creating operation:', error);
                alert('Ошибка при создании операции');
            }
        },

        async createWorkerParticipant() {
            if (!this.newWorker.name.trim()) {
                alert('Введите имя worker');
                return;
            }

            if (!this.workerParticipantTypeId) {
                alert(this.workerTypeError || 'Не найден тип participant_type "worker"');
                return;
            }

            try {
                const { error } = await sb
                    .from('Participants')
                    .insert({
                        name: this.newWorker.name.trim(),
                        participant_type_id: this.workerParticipantTypeId
                    });

                if (error) {
                    alert(`Ошибка при создании worker: ${error.message}`);
                    console.error(error);
                    return;
                }

                this.newWorker.name = '';
                await this.loadData();
                alert('Worker успешно создан');
            } catch (err) {
                console.error('Error creating worker participant:', err);
                alert('Ошибка при создании worker');
            }
        },

        async saveAllOperations() {
            try {
                let updated = false;
                for (const operation of this.allOperations) {
                    const originalAmount = this.originalAmounts[operation.id];

                    if (originalAmount !== undefined && Number(originalAmount) !== Number(operation.amount)) {
                        const { error: updateError } = await sb
                            .from('Operations')
                            .update({ amount: Math.floor(operation.amount) })
                            .eq('id', operation.id);

                        if (updateError) {
                            console.error('Ошибка при обновлении:', updateError);
                            alert(`Ошибка при сохранении операции ${operation.id}: ${updateError.message}`);
                            return;
                        }
                        updated = true;
                    }
                }

                if (updated) {
                    await this.loadData();
                    alert('Изменения успешно сохранены');
                } else {
                    alert('Нет изменений для сохранения');
                }
            } catch (error) {
                console.error('Ошибка при сохранении:', error);
                alert('Произошла ошибка при сохранении. Проверьте консоль.');
            }
        },

        async loadAdminDashboard() {
            try {
                const { data, error } = await sb
                    .from('v_participant_running_balance')
                    .select('*')
                    .order('op_date', { ascending: false });

                if (error) throw error;
                this.adminBalances = data || [];
            } catch (error) {
                console.error('Error loading admin dashboard:', error);
                alert(`Ошибка при загрузке дашборда: ${error.message}`);
            }
        },

        async loadWorkerSalaries() {
            try {
                const { data, error } = await sb
                    .from('v_worker_salary')
                    .select('*')
                    .order('op_date', { ascending: false });

                if (error) throw error;
                this.workerSalaries = data || [];
            } catch (error) {
                console.error('Error loading worker salaries:', error);
                alert(`Ошибка при загрузке зарплаты: ${error.message}`);
            }
        },

        async loadShopMembers() {
            try {
                const { data, error } = await sb
                    .from('shop_members')
                    .select('*')
                    .order('shop_id');

                if (error) throw error;
                this.shopMembers = data || [];
            } catch (error) {
                console.error('Error loading shop members:', error);
                alert(`Ошибка при загрузке работников: ${error.message}`);
            }
        },

        async createParticipant() {
            const { name, type } = this.newParticipant;

            if (!name.trim() || !type) {
                alert('Заполните все поля');
                return;
            }

            try {
                const typeRecord = this.participantTypes.find(t => t.code === type);
                if (!typeRecord) {
                    alert('Неверный тип участника');
                    return;
                }

                const { error } = await sb
                    .from('Participants')
                    .insert({
                        name: name.trim(),
                        participant_type_id: typeRecord.id
                    });

                if (error) throw error;

                this.newParticipant = { name: '', type: '' };
                await this.loadData();
                alert('Участник успешно создан');
            } catch (error) {
                console.error('Error creating participant:', error);
                alert(`Ошибка при создании: ${error.message}`);
            }
        },

        async deleteOperation(opId) {
            if (!confirm('Удалить операцию?')) return;

            try {
                const { error } = await sb
                    .from('Operations')
                    .delete()
                    .eq('id', opId);

                if (error) throw error;

                await this.loadData();
                alert('Операция удалена');
            } catch (error) {
                console.error('Error deleting operation:', error);
                alert(`Ошибка при удалении: ${error.message}`);
            }
        }
    },

    watch: {
        selectedParticipant() {
            this.newOperation.to = null;
            this.newOperation.amount = 0;
            this.currentPage = 1;
        },

        selectedShop() {
            this.newOperation.shop_id = this.selectedShop;
            this.currentPage = 1;
            if (this.isWorker) {
                this.loadData();
            }
        }
    },

    async mounted() {
        const { data } = await sb.auth.getUser();
        this.user = data.user;
        if (this.user) {
            await this.loadUserRole();
            await this.loadData();
        }
    }
}).mount('#app');