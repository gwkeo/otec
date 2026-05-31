import { createApp } from 'vue'
import { createClient } from '@supabase/supabase-js'

// Используем новые publishable ключи
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.error('Missing Supabase configuration!')
    throw new Error('Supabase configuration is required')
}

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

createApp({
    data() {
        return {
            user: null,
            email: '',
            password: '',
            participants: [],
            operations: [],
            snapshots: [],
            selectedParticipant: null,
            newOperation: {
                to: null,
                amount: 0
            },
            manualDate: false,
            selectedDate: new Date().toISOString().slice(0, 10),
            currentPage: 1,
            rowsPerPage: 10
        };
    },

    computed: {
        allOperations() {
            if (!this.selectedParticipant) return [];
            
            return this.operations.filter(
                op => op.from === this.selectedParticipant
            );
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
            
            return Number(participantSnapshots[0].amount || 0);
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
            this.participants = [];
            this.operations = [];
            this.snapshots = [];
            this.selectedParticipant = null;
            this.newOperation = { to: null, amount: 0 };
            this.currentPage = 1;
        },

        async loadData() {
            const { data: participants } = await sb
                .from('Participants')
                .select('*')
                .order('id');
            this.participants = participants || [];

            const { data: operations } = await sb
                .from('Operations')
                .select('*')
                .order('created_at', { ascending: false });
            this.operations = operations || [];

            const { data: snapshots } = await sb
                .from('Snapshot')
                .select('*');
            this.snapshots = snapshots || [];

            if (!this.selectedParticipant && this.participants.length) {
                this.selectedParticipant = this.participants[0].id;
            }
            
            this.currentPage = 1;
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
            const currentAmount = latestSnapshot ? Number(latestSnapshot.amount) : 0;
            
            const { error } = await sb
                .from('Snapshot')
                .insert({
                    participant_id: participantId,
                    amount: currentAmount + delta,
                    created_at: new Date().toISOString()
                });
            
            if (error) {
                console.error('Error updating snapshot:', error);
                throw error;
            }
        },

        async createOperation() {
            const { to, amount } = this.newOperation;
            
            if (!this.selectedParticipant) {
                alert('Выберите участника');
                return;
            }
            
            if (!to || amount <= 0) {
                alert('Заполните все поля');
                return;
            }
            
            let operationDate;
            if (this.manualDate && this.selectedDate) {
                operationDate = this.selectedDate;
            } else {
                operationDate = new Date().toISOString().slice(0, 10);
            }
            
            const fullDateTime = `${operationDate}T12:00:00Z`;
            
            const { error: opError } = await sb
                .from('Operations')
                .insert({
                    from: this.selectedParticipant,
                    to: to,
                    amount: amount,
                    created_at: fullDateTime
                });
            
            if (opError) {
                alert('Ошибка при создании операции');
                console.error(opError);
                return;
            }
            
            await this.updateSnapshot(this.selectedParticipant, -amount);
            await this.updateSnapshot(to, +amount);
            
            this.newOperation.amount = 0;
            this.newOperation.to = null;
            this.manualDate = false;
            this.selectedDate = new Date().toISOString().slice(0, 10);
            
            await this.loadData();
        },

        async saveAllOperations() {
            try {
                // Сохраняем только те операции, которые были изменены
                for (const operation of this.paginatedOperations) {
                    // Находим оригинальную операцию в массиве operations
                    const originalOp = this.operations.find(o => o.id === operation.id);
                    
                    // Проверяем, изменилась ли сумма
                    if (originalOp && Number(originalOp.amount) !== Number(operation.amount)) {
                        console.log(`Сохранение операции ${operation.id}: ${originalOp.amount} -> ${operation.amount}`);
                        
                        // Обновляем операцию в БД
                        const { error: updateError } = await sb
                            .from('Operations')
                            .update({ amount: Number(operation.amount) })
                            .eq('id', operation.id);
                        
                        if (updateError) {
                            console.error('Ошибка при обновлении:', updateError);
                            alert(`Ошибка при сохранении операции ${operation.id}: ${updateError.message}`);
                            return;
                        }
                        
                        // Рассчитываем разницу для снапшотов
                        const delta = Number(operation.amount) - Number(originalOp.amount);
                        
                        // Обновляем снапшот отправителя
                        await this.updateSnapshot(operation.from, -delta);
                        
                        // Обновляем снапшот получателя
                        await this.updateSnapshot(operation.to, +delta);
                    }
                }
                
                // Перезагружаем данные
                await this.loadData();
                alert('Изменения успешно сохранены');
                
            } catch (error) {
                console.error('Ошибка при сохранении:', error);
                alert('Произошла ошибка при сохранении. Проверьте консоль.');
            }
        }
    },

    watch: {
        selectedParticipant() {
            this.newOperation.to = null;
            this.newOperation.amount = 0;
            this.currentPage = 1;
        }
    },

    async mounted() {
        const { data } = await sb.auth.getUser();
        this.user = data.user;
        if (this.user) {
            await this.loadData();
        }
    }
}).mount('#app');