import { useStore, TestResult, isTestSupported } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TestTube, Play, CheckCircle2, XCircle, Clock, Filter, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function Tests() {
  const { tests, runTest, runAllTests, mode, updateTestNote, capabilities } = useStore();
  const [filter, setFilter] = useState('ALL');
  const [manualObservationTx, setManualObservationTx] = useState<TestResult | null>(null);
  const [obsNote, setObsNote] = useState('');

  const supportedTests = tests.filter(t => isTestSupported(t, capabilities));

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed': return <CheckCircle2 className="w-4 h-4 text-success" />;
      case 'failed': return <XCircle className="w-4 h-4 text-destructive" />;
      case 'running': return <Clock className="w-4 h-4 text-warning animate-pulse" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const isRunning = supportedTests.some(t => t.status === 'running');
  const passedCount = supportedTests.filter(t => t.status === 'passed').length;
  const failedCount = supportedTests.filter(t => t.status === 'failed').length;

  const filteredTests = supportedTests.filter(t => filter === 'ALL' || t.category === filter);
  const categories = ['ALL', ...Array.from(new Set(supportedTests.map(t => t.category)))];

  const handleSaveObservation = () => {
    if (manualObservationTx) {
      updateTestNote(manualObservationTx.id, obsNote);
      setManualObservationTx(null);
      setObsNote('');
    }
  };

  return (
    <>
      <Card data-tour="tests-suite" className="flex flex-col h-full border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <div data-tour="tests-actions" className="flex flex-row items-center justify-between mb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
              <TestTube className="w-4 h-4" />
              Validation Suite
            </CardTitle>
            <div className="flex items-center gap-4">
              <div className="text-[10px] font-mono text-muted-foreground bg-black/30 px-2 py-1 rounded">
                {mode === 'hardware' ? 'HARDWARE VALIDATION REQUIRED' : 'SIMULATION VALIDATION'}
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-[10px] font-mono border-primary text-primary hover:bg-primary/20"
                onClick={runAllTests}
                disabled={isRunning || mode === 'hardware'}
              >
                <Play className="w-3 h-3 mr-1" /> RUN ALL
              </Button>
            </div>
          </div>
          
          <div className="flex justify-between items-center bg-black/30 p-2 rounded-sm border border-border/30">
            <div className="flex gap-2">
              {categories.map(cat => (
                <Button 
                  key={cat} 
                  variant="ghost" 
                  size="sm" 
                  className={`h-6 text-[10px] font-mono ${filter === cat ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-white/5'}`}
                  onClick={() => setFilter(cat)}
                >
                  <Filter className="w-3 h-3 mr-1" /> {cat.toUpperCase()}
                </Button>
              ))}
            </div>
            <div className="flex gap-4 font-mono text-xs">
              <span className="text-muted-foreground">TOTAL: {supportedTests.length}</span>
              <span className="text-success">PASS: {passedCount}</span>
              <span className="text-destructive">FAIL: {failedCount}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden">
          <div data-tour="tests-table" className="h-[calc(100vh-16rem)] overflow-y-auto custom-scrollbar">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] text-muted-foreground w-12"></TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground">TEST CASE</TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground">CATEGORY</TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground">EXPECTED BEHAVIOR</TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground">RESULT / EVIDENCE</TableHead>
                  <TableHead className="font-mono text-[10px] text-muted-foreground text-right">ACTION</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="font-mono text-xs">
                {filteredTests.map(test => (
                  <TableRow key={test.id} className="border-border/20 hover:bg-white/5">
                    <TableCell className="text-center">{getStatusIcon(test.status)}</TableCell>
                    <TableCell className="font-bold text-foreground/90">
                      {test.name}
                      {test.manualNote && (
                        <div className="text-[10px] font-normal text-primary mt-1 flex items-start gap-1">
                           <FileText className="w-3 h-3 shrink-0" /> Obs: {test.manualNote}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{test.category}</TableCell>
                    <TableCell className="text-muted-foreground text-[10px] max-w-xs">{test.expected}</TableCell>
                    <TableCell>
                      {test.status === 'passed' ? (
                        <div className="text-success text-[10px]">{test.evidence || 'Passed'}</div>
                      ) : test.status === 'failed' ? (
                        <div className="text-destructive text-[10px]">{test.actual || 'Failed'}</div>
                      ) : (
                        <div className="text-muted-foreground text-[10px]">-</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => { setManualObservationTx(test); setObsNote(test.manualNote || ''); }}
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          title="Add Manual Observation"
                        >
                          <FileText className="w-3 h-3" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => runTest(test.id)}
                          disabled={test.status === 'running' || mode === 'hardware'}
                          className="h-7 text-[10px] font-mono border-border hover:text-primary hover:border-primary"
                        >
                          <Play className="w-3 h-3 mr-1" /> RUN
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!manualObservationTx} onOpenChange={(o) => !o && setManualObservationTx(null)}>
        <DialogContent className="border-border bg-card font-mono">
          <DialogHeader>
             <DialogTitle className="text-primary text-sm">Manual Observation Log</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
             <div className="text-xs text-muted-foreground">Test: {manualObservationTx?.name}</div>
             <textarea 
               value={obsNote} 
               onChange={e => setObsNote(e.target.value)} 
               className="w-full h-32 bg-black/20 border border-border/50 rounded-sm text-sm p-3 focus:outline-none focus:border-primary text-foreground"
               placeholder="Enter external validation evidence or observations..."
             />
          </div>
          <DialogFooter>
             <Button variant="outline" onClick={handleSaveObservation} className="border-primary text-primary hover:bg-primary/20 font-mono text-xs">
               SAVE OBSERVATION
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
