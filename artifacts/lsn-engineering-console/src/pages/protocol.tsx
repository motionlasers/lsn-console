import { useStore, Transaction } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Network, Search, ArrowRight, ArrowLeft, ArrowLeftRight, Copy, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ProtocolInspector() {
  const { transactions, clearTransactions } = useStore();
  const [filter, setFilter] = useState('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const filteredTxs = transactions.filter(tx => 
    tx.command.toLowerCase().includes(filter.toLowerCase()) || 
    tx.mapping?.toLowerCase().includes(filter.toLowerCase()) ||
    tx.requestHex.toLowerCase().includes(filter.toLowerCase()) ||
    tx.responseHex.toLowerCase().includes(filter.toLowerCase())
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <>
      <Card data-tour="protocol-transactions" className="flex flex-col h-full border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Network className="w-4 h-4" />
            Protocol Transaction Log
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="FILTER HEX, CMD..." 
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="bg-black/20 border border-border/50 rounded-sm text-xs font-mono px-2 py-1 pl-6 focus:outline-none focus:border-primary w-48"
              />
            </div>
            <Button variant="outline" size="sm" onClick={clearTransactions} className="h-7 text-[10px] font-mono border-border">
              CLEAR LOG
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <div data-tour="protocol-table" className="h-[calc(100vh-16rem)] overflow-y-auto custom-scrollbar">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-20 font-mono text-[10px] text-muted-foreground">SEQ</TableHead>
                  <TableHead className="w-20 font-mono text-[10px] text-muted-foreground">DIR</TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground">OPERATION</TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground">MAPPING</TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground">STATUS</TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground text-right">LATENCY</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="font-mono text-xs">
                {filteredTxs.length === 0 && (
                  <TableRow className="border-b-0 hover:bg-transparent">
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      NO TRANSACTIONS RECORDED
                    </TableCell>
                  </TableRow>
                )}
                {filteredTxs.map(tx => (
                  <TableRow key={tx.id} className="border-border/20 hover:bg-white/5 cursor-pointer" onClick={() => setSelectedTx(tx)}>
                    <TableCell className="text-muted-foreground">{tx.sequence.toString().padStart(4, '0')}</TableCell>
                    <TableCell>
                      {tx.direction === 'tx' 
                        ? <span className="text-primary flex items-center gap-1"><ArrowRight className="w-3 h-3"/> TX</span>
                        : tx.direction === 'rx' 
                          ? <span className="text-success flex items-center gap-1"><ArrowLeft className="w-3 h-3"/> RX</span>
                          : <span className="text-warning flex items-center gap-1"><ArrowLeftRight className="w-3 h-3"/> BI</span>
                      }
                    </TableCell>
                    <TableCell>
                      <div className="font-bold text-foreground/90">{tx.command}</div>
                      <div className="text-[10px] text-muted-foreground">SVC: {tx.service}</div>
                    </TableCell>
                    <TableCell className="text-foreground/80">{tx.mapping || '-'}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tx.status === 'ok' ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                        {tx.status.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {tx.latency > 0 ? `${tx.latency}ms` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedTx} onOpenChange={(open) => !open && setSelectedTx(null)}>
        <DialogContent className="max-w-2xl bg-card border-border font-mono">
          <DialogHeader>
            <DialogTitle className="text-primary flex items-center gap-2">
              <Network className="w-4 h-4" />
              Transaction Detail #{selectedTx?.sequence.toString().padStart(4, '0')}
            </DialogTitle>
          </DialogHeader>
          
          {selectedTx && (
            <div className="space-y-6 mt-4">
              <div className="grid grid-cols-2 gap-4">
                 <div className="border border-border/50 p-3 bg-black/20 rounded-sm">
                   <div className="text-[10px] text-muted-foreground uppercase mb-1">Expected Result</div>
                   <div className="text-sm">{selectedTx.expectedResult}</div>
                 </div>
                 <div className="border border-border/50 p-3 bg-black/20 rounded-sm">
                   <div className="text-[10px] text-muted-foreground uppercase mb-1 flex items-center gap-2">
                     Actual Result 
                     {selectedTx.pass ? <CheckCircle2 className="w-3 h-3 text-success"/> : <XCircle className="w-3 h-3 text-destructive"/>}
                   </div>
                   <div className={`text-sm ${selectedTx.pass ? 'text-success' : 'text-destructive'}`}>{selectedTx.actualResult}</div>
                 </div>
              </div>

              <div className="space-y-4">
                <div className="border border-border/50 rounded-sm overflow-hidden">
                  <div className="bg-black/30 px-3 py-2 border-b border-border/50 text-xs text-primary flex justify-between items-center">
                    <span>REQUEST DATA</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-[9px]" onClick={() => copyToClipboard(selectedTx.requestHex)}><Copy className="w-3 h-3 mr-1" /> RAW</Button>
                      <Button variant="ghost" size="sm" className="h-6 text-[9px]" onClick={() => copyToClipboard(selectedTx.requestDecoded)}><Copy className="w-3 h-3 mr-1" /> DECODED</Button>
                    </div>
                  </div>
                  <div className="p-3 bg-black/10 text-xs">
                    <div className="mb-2 break-all text-foreground/80">{selectedTx.requestHex || 'NO HEX DATA'}</div>
                    <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/30">
                      Decoded: {selectedTx.requestDecoded}
                    </div>
                  </div>
                </div>

                <div className="border border-border/50 rounded-sm overflow-hidden">
                  <div className="bg-black/30 px-3 py-2 border-b border-border/50 text-xs text-success flex justify-between items-center">
                    <span>RESPONSE DATA</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-[9px]" onClick={() => copyToClipboard(selectedTx.responseHex)}><Copy className="w-3 h-3 mr-1" /> RAW</Button>
                      <Button variant="ghost" size="sm" className="h-6 text-[9px]" onClick={() => copyToClipboard(selectedTx.responseDecoded)}><Copy className="w-3 h-3 mr-1" /> DECODED</Button>
                    </div>
                  </div>
                  <div className="p-3 bg-black/10 text-xs">
                    <div className="mb-2 break-all text-foreground/80">{selectedTx.responseHex || 'NO HEX DATA'}</div>
                    <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/30">
                      Decoded: {selectedTx.responseDecoded}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
