import React from 'react';
import { View, Dimensions, StyleSheet } from 'react-native';
import { LineChart, BarChart, PieChart } from 'react-native-chart-kit';
import { colors } from '@/src/constants/colors';

const screenWidth = Dimensions.get('window').width;

interface LineChartProps {
  data: {
    labels: string[];
    datasets: { data: number[] }[];
  };
  height?: number;
}

export function AppLineChart({ data, height = 220 }: LineChartProps) {
  return (
    <View style={styles.container}>
      <LineChart
        data={data}
        width={screenWidth - 48}
        height={height}
        chartConfig={{
          backgroundColor: colors.card,
          backgroundGradientFrom: colors.card,
          backgroundGradientTo: colors.card,
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
          style: {
            borderRadius: 16,
          },
          propsForDots: {
            r: '4',
            strokeWidth: '2',
            stroke: colors.primary,
          },
        }}
        bezier
        style={styles.chart}
      />
    </View>
  );
}

interface BarChartProps {
  data: {
    labels: string[];
    datasets: { data: number[] }[];
  };
  height?: number;
}

export function AppBarChart({ data, height = 220 }: BarChartProps) {
  return (
    <View style={styles.container}>
      <BarChart
        data={data}
        width={screenWidth - 48}
        height={height}
        yAxisLabel="₹"
        yAxisSuffix=""
        chartConfig={{
          backgroundColor: colors.card,
          backgroundGradientFrom: colors.card,
          backgroundGradientTo: colors.card,
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
          style: {
            borderRadius: 16,
          },
        }}
        style={styles.chart}
      />
    </View>
  );
}

interface PieChartDataItem {
  name: string;
  population: number;
  color: string;
  legendFontColor: string;
  legendFontSize: number;
}

interface AppPieChartProps {
  data: PieChartDataItem[];
  height?: number;
}

export function AppPieChart({ data, height = 220 }: AppPieChartProps) {
  return (
    <View style={styles.container}>
      <PieChart
        data={data}
        width={screenWidth - 48}
        height={height}
        chartConfig={{
          color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
        }}
        accessor="population"
        backgroundColor="transparent"
        paddingLeft="15"
        style={styles.chart}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  chart: {
    borderRadius: 16,
  },
});
